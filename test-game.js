const WebSocket = require('ws');

const URL = process.env.TEST_URL || 'ws://frontend/ws';

function makeClient(nickname) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const client = { ws, nickname, playerId: null, roomId: null, symbol: null, lastState: null };

    ws.on('open', () => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        console.log(`[${nickname}] recu:`, msg.type);
        if (msg.type === 'welcome') {
          client.playerId = msg.playerId;
          ws.send(JSON.stringify({ type: 'find_match', nickname }));
        } else if (msg.type === 'match_found') {
          client.roomId = msg.roomId;
          client.symbol = msg.symbol;
          client.lastState = msg.state;
          console.log(`${nickname} a rejoint la partie ${msg.roomId} en tant que ${msg.symbol}`);
          resolve(client);
        } else if (msg.type === 'state_update') {
          client.lastState = msg.state;
        }
      });
    });
  });
}

function move(client, cellIndex) {
  client.ws.send(JSON.stringify({ type: 'move', roomId: client.roomId, cellIndex }));
}

function waitForTurn(client, expectedTurn, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (client.lastState && (client.lastState.turn === expectedTurn || client.lastState.status === 'finished')) {
        return resolve();
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for turn'));
      setTimeout(check, 100);
    };
    check();
  });
}

async function main() {
  console.log('--- Connexion des 2 joueurs ---');
  const [alice, bob] = await Promise.all([makeClient('Alice'), makeClient('Bob')]);

  // Sequence de victoire pour Alice (X) : X gagne sur la premiere ligne (0,1,2)
  // O joue ailleurs (3,4) sans bloquer.
  const sequence = [
    { player: alice, cell: 0 },
    { player: bob, cell: 3 },
    { player: alice, cell: 1 },
    { player: bob, cell: 4 },
    { player: alice, cell: 2 }, // Alice complete la ligne 0-1-2 -> victoire
  ];

  for (const step of sequence) {
    move(step.player, step.cell);
    await new Promise((r) => setTimeout(r, 300));
  }

  await waitForTurn(alice, null, 3000);
  console.log('--- Etat final ---');
  console.log(JSON.stringify(alice.lastState, null, 2));

  if (alice.lastState.status === 'finished' && alice.lastState.winner === 'X') {
    console.log('OK : Alice (X) a bien gagne la partie.');
  } else {
    console.error('ECHEC : resultat de partie inattendu.');
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 1000));

  console.log('--- Verification du leaderboard ---');
  const res = await fetch(process.env.TEST_HTTP_URL || 'http://frontend/api/leaderboard/top');
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));

  const aliceScore = body.data.find((r) => r.nickname === 'Alice');
  const bobScore = body.data.find((r) => r.nickname === 'Bob');
  if (aliceScore && aliceScore.wins >= 1 && bobScore && bobScore.losses >= 1) {
    console.log('OK : le leaderboard reflete bien la victoire d\'Alice et la defaite de Bob.');
  } else {
    console.error('ECHEC : le leaderboard ne reflete pas le resultat attendu.');
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('ECHEC test:', err);
  process.exit(1);
});
