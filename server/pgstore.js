// DUSTLINE Postgres store — durable account + session persistence.
// Used when DATABASE_URL is set; otherwise falls back to the JSON file store.
// Schema: accounts (one row per user), sessions (opaque bearer token -> account).
import pg from 'pg';

const { Pool } = pg;

export async function connectPostgres(url) {
  const pool = new Pool({ connectionString: url, max: 5 });
  // verify connectivity
  const c = await pool.connect();
  try {
    await c.query('SELECT 1');
  } finally {
    c.release();
  }
  return pool;
}

export async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      device_id       TEXT PRIMARY KEY,
      username        TEXT UNIQUE,
      password_hash   TEXT,
      name            TEXT NOT NULL DEFAULT 'OPERATIVE',
      total_xp        INTEGER NOT NULL DEFAULT 0,
      stats           JSONB NOT NULL DEFAULT '{}',
      loadout         JSONB NOT NULL DEFAULT '{"primary":"m4","secondary":"pistol"}',
      unlocked_weapons JSONB NOT NULL DEFAULT '["m4","pistol","knife"]',
      prestige        INTEGER NOT NULL DEFAULT 0,
      last_seen       BIGINT NOT NULL DEFAULT 0,
      created_at      BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      device_id  TEXT NOT NULL REFERENCES accounts(device_id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL DEFAULT 0,
      expires_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id);
  `);
}

export async function getAccount(pool, deviceId) {
  const r = await pool.query('SELECT * FROM accounts WHERE device_id = $1', [deviceId]);
  return r.rows[0] ? rowToAccount(r.rows[0]) : null;
}

export async function getAccountByName(pool, username) {
  const r = await pool.query('SELECT * FROM accounts WHERE username = $1', [username]);
  return r.rows[0] ? rowToAccount(r.rows[0]) : null;
}

export async function createAccount(pool, { deviceId, name, username, passwordHash }) {
  const now = Date.now();
  const r = await pool.query(
    `INSERT INTO accounts (device_id, username, password_hash, name, last_seen, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (device_id) DO UPDATE SET name = EXCLUDED.name, last_seen = EXCLUDED.last_seen
     RETURNING *`,
    [deviceId, username || null, passwordHash || null, name || 'OPERATIVE', now, now]
  );
  return rowToAccount(r.rows[0]);
}

export async function setPassword(pool, deviceId, passwordHash) {
  await pool.query('UPDATE accounts SET password_hash = $2 WHERE device_id = $1', [deviceId, passwordHash]);
}

export async function saveLoadout(pool, deviceId, loadout) {
  await pool.query(
    'UPDATE accounts SET loadout = $2, last_seen = $3 WHERE device_id = $1',
    [deviceId, JSON.stringify({ primary: loadout.primary || 'm4', secondary: loadout.secondary || 'pistol' }), Date.now()]
  );
}

export async function touchAccount(pool, deviceId) {
  await pool.query('UPDATE accounts SET last_seen = $1 WHERE device_id = $2', [Date.now(), deviceId]);
}

export async function applyMatchResultToAccount(pool, deviceId, { kills, deaths, assists, won, score, xp }) {
  const r = await pool.query(
    `UPDATE accounts SET
       total_xp = total_xp + $2,
       stats = stats || jsonb_build_object(
         'kills', (stats->>'kills')::int + $3,
         'deaths', (stats->>'deaths')::int + $4,
         'assists', (stats->>'assists')::int + $5,
         'score', (stats->>'score')::int + $6,
         'games', (stats->>'games')::int + 1,
         'wins', (stats->>'wins')::int + $7,
         'losses', (stats->>'losses')::int + $8,
         'bestStreak', GREATEST((stats->>'bestStreak')::int, $9)
       ),
       unlocked_weapons = (SELECT jsonb_agg(DISTINCT w) FROM jsonb_array_elements_text(unlocked_weapons) w
         UNION SELECT w FROM jsonb_array_elements_text($10::jsonb) w),
       last_seen = $11
     WHERE device_id = $1
     RETURNING *`,
    [
      deviceId,
      xp, kills, deaths, assists, score,
      won ? 1 : 0, won ? 0 : 1, kills, JSON.stringify(['m4', 'pistol', 'knife', 'mp5', 'shotgun', 'ak', 'm249', 'sniper']),
      Date.now(),
    ]
  );
  return r.rows[0] ? rowToAccount(r.rows[0]) : null;
}

// ---- sessions ----
export async function createSession(pool, deviceId, token, ttlMs) {
  const now = Date.now();
  await pool.query(
    'INSERT INTO sessions (token, device_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [token, deviceId, now, now + ttlMs]
  );
}

export async function getSession(pool, token) {
  const r = await pool.query('SELECT * FROM sessions WHERE token = $1 AND expires_at > $2', [token, Date.now()]);
  return r.rows[0] || null;
}

export async function deleteSession(pool, token) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function deleteSessionsForDevice(pool, deviceId) {
  await pool.query('DELETE FROM sessions WHERE device_id = $1', [deviceId]);
}

export function rowToAccount(row) {
  return {
    deviceId: row.device_id,
    username: row.username,
    passwordHash: row.password_hash,
    name: row.name,
    totalXp: row.total_xp,
    stats: row.stats || {},
    loadout: row.loadout || { primary: 'm4', secondary: 'pistol' },
    unlockedWeapons: row.unlocked_weapons || ['m4', 'pistol', 'knife'],
    prestige: row.prestige,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
  };
}
