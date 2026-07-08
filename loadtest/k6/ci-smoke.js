import http from 'k6/http';

// Test de charge court utilise comme "gate" de la pipeline CI/CD : rejoue
// juste apres chaque deploiement pour detecter une regression de performance
// avant de considerer le déploiement reussi. Volontairement plus court que
// loadtest/k6/leaderboard-load.js (utilise pour la demo de scale-out manuelle)
// pour ne pas ralentir chaque push.
export const options = {
  vus: 20,
  duration: '20s',
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal';

export default function () {
  const nickname = `ci-bot-${__VU}`;
  http.post(
    `${BASE_URL}/api/scores`,
    JSON.stringify({ nickname, result: 'win' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  http.get(`${BASE_URL}/api/leaderboard/top`);
}
