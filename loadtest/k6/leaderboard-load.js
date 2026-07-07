import http from 'k6/http';

export const options = {
  scenarios: {
    ramping: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '2m', target: 150 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal';

export default function () {
  const nickname = `bot-${__VU}`;
  http.post(
    `${BASE_URL}/api/scores`,
    JSON.stringify({ nickname, result: 'win' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  http.get(`${BASE_URL}/api/leaderboard/top`);
}
