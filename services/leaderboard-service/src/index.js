const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const Redis = require('ioredis');
const client = require('prom-client');

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_KEY = 'leaderboard:top10';
const CACHE_TTL_SECONDS = 30;

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'nexusplay',
  password: process.env.PGPASSWORD || 'nexusplay',
  database: process.env.PGDATABASE || 'nexusplay',
});

const redis = new Redis(REDIS_URL);

client.collectDefaultMetrics();
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duree des requetes HTTP en secondes',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: req.path, status_code: res.statusCode });
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scores (
      nickname TEXT PRIMARY KEY,
      wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      draws INT NOT NULL DEFAULT 0
    )
  `);
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'leaderboard-service' }));

app.get('/leaderboard/top', async (req, res) => {
  const cached = await redis.get(CACHE_KEY);
  if (cached) {
    return res.json({ source: 'cache', data: JSON.parse(cached) });
  }

  const { rows } = await pool.query(
    'SELECT nickname, wins, losses, draws FROM scores ORDER BY wins DESC, losses ASC LIMIT 10'
  );
  await redis.set(CACHE_KEY, JSON.stringify(rows), 'EX', CACHE_TTL_SECONDS);
  res.json({ source: 'db', data: rows });
});

app.post('/scores', async (req, res) => {
  const { nickname, result } = req.body;
  if (!nickname || !['win', 'loss', 'draw'].includes(result)) {
    return res.status(400).json({ error: 'nickname et result (win|loss|draw) requis' });
  }

  const column = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws';
  await pool.query(
    `INSERT INTO scores (nickname, ${column}) VALUES ($1, 1)
     ON CONFLICT (nickname) DO UPDATE SET ${column} = scores.${column} + 1`,
    [nickname]
  );
  await redis.del(CACHE_KEY); // invalidation du cache apres ecriture

  res.status(201).json({ ok: true });
});

async function start(retriesLeft = 10) {
  try {
    await ensureSchema();
    app.listen(PORT, () => console.log(`leaderboard-service ecoute sur le port ${PORT}`));
  } catch (err) {
    if (retriesLeft <= 0) {
      console.error('Echec initialisation schema Postgres, abandon:', err.message);
      process.exit(1);
    }
    console.log(`Postgres pas encore pret (${err.message}), nouvelle tentative dans 2s... (${retriesLeft} restantes)`);
    setTimeout(() => start(retriesLeft - 1), 2000);
  }
}

start();
