const statusEl = document.getElementById('status');
const boardEl = document.getElementById('board');
const cells = document.querySelectorAll('.cell');
const findMatchBtn = document.getElementById('findMatchBtn');
const nicknameInput = document.getElementById('nickname');
const leaderboardBody = document.querySelector('#leaderboard tbody');

let playerId = null;
let roomId = null;
let mySymbol = null;

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'welcome') {
    playerId = msg.playerId;
  } else if (msg.type === 'match_found') {
    roomId = msg.roomId;
    mySymbol = msg.symbol;
    boardEl.classList.remove('hidden');
    renderState(msg.state);
  } else if (msg.type === 'state_update') {
    renderState(msg.state);
    if (msg.state.status === 'finished') {
      setTimeout(loadLeaderboard, 500);
    }
  }
};

function renderState(state) {
  state.board.forEach((value, i) => {
    cells[i].textContent = value || '';
  });

  if (state.status === 'finished') {
    if (state.winner === 'draw') {
      statusEl.textContent = 'Match nul !';
    } else {
      const winnerNick = state.players[state.winner].nickname;
      statusEl.textContent = `${winnerNick} (${state.winner}) a gagne !`;
    }
  } else {
    statusEl.textContent = state.turn === mySymbol
      ? `A toi de jouer (${mySymbol})`
      : `Au tour de l'adversaire...`;
  }
}

findMatchBtn.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim() || 'Joueur';
  statusEl.textContent = 'Recherche d\'un adversaire...';
  ws.send(JSON.stringify({ type: 'find_match', nickname }));
});

cells.forEach((cell) => {
  cell.addEventListener('click', () => {
    if (!roomId) return;
    const cellIndex = Number(cell.dataset.index);
    ws.send(JSON.stringify({ type: 'move', roomId, cellIndex }));
  });
});

async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard/top');
    const { data } = await res.json();
    leaderboardBody.innerHTML = data
      .map((row) => `<tr><td>${row.nickname}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.draws}</td></tr>`)
      .join('');
  } catch (err) {
    console.error('Erreur chargement leaderboard', err);
  }
}

loadLeaderboard();
setInterval(loadLeaderboard, 10000);
