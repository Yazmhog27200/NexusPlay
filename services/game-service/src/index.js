const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const { checkOutcome } = require('./tictactoe');

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const LEADERBOARD_URL = process.env.LEADERBOARD_URL || 'http://localhost:3001';
const EVENTS_CHANNEL = 'game:events';

const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'game-service' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Deux connexions Redis distinctes : une pour les commandes normales, une
// dediee au mode subscribe (ioredis l'impose des qu'on utilise SUBSCRIBE).
const redis = new Redis(REDIS_URL);
const redisSub = new Redis(REDIS_URL);

// Connexions WebSocket vivantes sur CE pod, indexees par playerId.
// Necessaire car un match peut mettre en relation 2 joueurs connectes a
// 2 pods differents : seul le pod qui possede la connexion peut lui parler,
// d'ou le passage par un canal Redis pub/sub partage entre tous les pods.
const localConnections = new Map();

redisSub.subscribe(EVENTS_CHANNEL);
redisSub.on('message', (channel, raw) => {
  if (channel !== EVENTS_CHANNEL) return;
  const event = JSON.parse(raw);
  for (const targetId of event.to) {
    const ws = localConnections.get(targetId);
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(event.payload));
    }
  }
});

function publishTo(playerIds, payload) {
  redis.publish(EVENTS_CHANNEL, JSON.stringify({ to: playerIds, payload }));
}

async function roomKey(roomId) {
  return `room:${roomId}`;
}

async function saveRoom(roomId, state) {
  await redis.set(await roomKey(roomId), JSON.stringify(state), 'EX', 3600);
}

async function loadRoom(roomId) {
  const raw = await redis.get(await roomKey(roomId));
  return raw ? JSON.parse(raw) : null;
}

async function reportScore(nickname, result) {
  try {
    await fetch(`${LEADERBOARD_URL}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, result }),
    });
  } catch (err) {
    console.error('Impossible de contacter leaderboard-service:', err.message);
  }
}

async function findMatch(playerId, nickname) {
  // On depile un joueur en attente ; s'il y en a un, on cree la partie.
  const waitingRaw = await redis.lpop('waiting_players');

  if (!waitingRaw) {
    await redis.rpush('waiting_players', JSON.stringify({ playerId, nickname }));
    return; // le client reste en "waiting" jusqu'a ce qu'un adversaire arrive
  }

  const waiting = JSON.parse(waitingRaw);
  const roomId = uuidv4();
  const state = {
    roomId,
    board: Array(9).fill(null),
    turn: 'X',
    players: {
      X: { id: waiting.playerId, nickname: waiting.nickname },
      O: { id: playerId, nickname },
    },
    status: 'playing',
    winner: null,
  };
  await saveRoom(roomId, state);

  publishTo([waiting.playerId], { type: 'match_found', roomId, symbol: 'X', state });
  publishTo([playerId], { type: 'match_found', roomId, symbol: 'O', state });
}

async function playMove(playerId, roomId, cellIndex) {
  const state = await loadRoom(roomId);
  if (!state || state.status !== 'playing') return;

  const mySymbol = state.players.X.id === playerId ? 'X' : state.players.O.id === playerId ? 'O' : null;
  if (!mySymbol || state.turn !== mySymbol) return; // pas ton tour / pas ta partie
  if (cellIndex < 0 || cellIndex > 8 || state.board[cellIndex] !== null) return;

  state.board[cellIndex] = mySymbol;
  const outcome = checkOutcome(state.board);

  if (outcome) {
    state.status = 'finished';
    state.winner = outcome;
    const { X, O } = state.players;
    if (outcome === 'draw') {
      await reportScore(X.nickname, 'draw');
      await reportScore(O.nickname, 'draw');
    } else {
      const winnerNick = outcome === 'X' ? X.nickname : O.nickname;
      const loserNick = outcome === 'X' ? O.nickname : X.nickname;
      await reportScore(winnerNick, 'win');
      await reportScore(loserNick, 'loss');
    }
  } else {
    state.turn = mySymbol === 'X' ? 'O' : 'X';
  }

  await saveRoom(roomId, state);
  const ids = [state.players.X.id, state.players.O.id];
  publishTo(ids, { type: 'state_update', roomId, state });
}

wss.on('connection', (ws) => {
  const playerId = uuidv4();
  localConnections.set(playerId, ws);
  ws.send(JSON.stringify({ type: 'welcome', playerId }));

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'find_match') {
      await findMatch(playerId, msg.nickname || 'Joueur');
    } else if (msg.type === 'move') {
      await playMove(playerId, msg.roomId, msg.cellIndex);
    }
  });

  ws.on('close', () => {
    localConnections.delete(playerId);
  });
});

server.listen(PORT, () => {
  console.log(`game-service ecoute sur le port ${PORT}`);
});
