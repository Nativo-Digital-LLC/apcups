import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Resolve DB path: prefer DATA_DIR env var (for Docker volumes), fallback to local data/
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'ups.db');
const db = new Database(DB_PATH);

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    bcharge   REAL    NOT NULL,
    loadpct   REAL    NOT NULL,
    linev     REAL    NOT NULL,
    battv     REAL    NOT NULL,
    timeleft  REAL    NOT NULL,
    status    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    type        TEXT    NOT NULL,
    severity    TEXT    NOT NULL CHECK(severity IN ('info','warning','critical')),
    description TEXT    NOT NULL,
    value       TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint   TEXT    NOT NULL UNIQUE,
    p256dh     TEXT    NOT NULL,
    auth       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    host         TEXT    NOT NULL,
    port         INTEGER NOT NULL DEFAULT 22,
    user         TEXT    NOT NULL,
    private_key  TEXT,
    password     TEXT,
    shutdown_cmd TEXT    NOT NULL DEFAULT 'sudo shutdown -h now',
    ups_cmd      TEXT,
    node_order   INTEGER NOT NULL DEFAULT 1,
    enabled      INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp);
`);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id?: number;
  timestamp: number;
  bcharge: number;
  loadpct: number;
  linev: number;
  battv: number;
  timeleft: number;
  status: string;
}

export type EventSeverity = 'info' | 'warning' | 'critical';

export interface UPSEvent {
  id: number;
  timestamp: number;
  type: string;
  severity: EventSeverity;
  description: string;
  value?: string;
}

// ── Prepared statements ───────────────────────────────────────────────────────

const insertHistory = db.prepare<Omit<HistoryEntry, 'id'>>(`
  INSERT INTO history (timestamp, bcharge, loadpct, linev, battv, timeleft, status)
  VALUES (@timestamp, @bcharge, @loadpct, @linev, @battv, @timeleft, @status)
`);

const insertEvent = db.prepare<Omit<UPSEvent, 'id'>>(`
  INSERT INTO events (timestamp, type, severity, description, value)
  VALUES (@timestamp, @type, @severity, @description, @value)
`);

// ── Public API ────────────────────────────────────────────────────────────────

/** Save a new history snapshot */
export function saveHistory(entry: Omit<HistoryEntry, 'id'>): void {
  insertHistory.run(entry);
}

/** Returns history entries newer than `sinceMs` (epoch ms), limited to `limit` rows */
export function getHistory(sinceMs = 0, limit = 1440): HistoryEntry[] {
  return db.prepare<[number, number], HistoryEntry>(
    `SELECT * FROM history WHERE timestamp >= ? ORDER BY timestamp ASC LIMIT ?`
  ).all(sinceMs, limit) as HistoryEntry[];
}

/** Returns all history (last 24 h = 1440 entries) */
export function getAllHistory(): HistoryEntry[] {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return getHistory(cutoff, 1440);
}

/** Save a new event and return its auto-incremented id */
export function saveEvent(event: Omit<UPSEvent, 'id'>): UPSEvent {
  const info = insertEvent.run(event);
  return { ...event, id: Number(info.lastInsertRowid) };
}

/** Returns the latest `limit` events, newest-first */
export function getEvents(limit = 200): UPSEvent[] {
  return db.prepare<[number], UPSEvent>(
    `SELECT * FROM events ORDER BY timestamp DESC LIMIT ?`
  ).all(limit) as UPSEvent[];
}

/** Find the last event of a given type (for dedup logic) */
export function getLastEventOfType(type: string): UPSEvent | undefined {
  return db.prepare<[string], UPSEvent>(
    `SELECT * FROM events WHERE type = ? ORDER BY timestamp DESC LIMIT 1`
  ).get(type) as UPSEvent | undefined;
}

/** Prune history older than 24 hours and events beyond the last 200 */
export function pruneOld(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  db.prepare(`DELETE FROM history WHERE timestamp < ?`).run(cutoff);
  db.prepare(`
    DELETE FROM events WHERE id NOT IN (
      SELECT id FROM events ORDER BY timestamp DESC LIMIT 200
    )
  `).run();
}

console.log(`[SQLite] Database opened at ${DB_PATH}`);

// ── Settings ──────────────────────────────────────────────────────────────────

export function getSetting(key: string, defaultValue = ''): string {
  const row = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? defaultValue;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ── Push Subscriptions ────────────────────────────────────────────────────────

export interface PushSubscription {
  id?: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
}

export function getPushSubscriptions(): PushSubscription[] {
  return db.prepare<[], PushSubscription>('SELECT * FROM push_subscriptions').all();
}

export function addPushSubscription(sub: Omit<PushSubscription, 'id'>): void {
  db.prepare(
    'INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (@endpoint, @p256dh, @auth, @created_at) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth'
  ).run(sub);
}

export function removePushSubscription(endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

export interface SwarmNode {
  id?: number;
  name: string;
  host: string;
  port: number;
  user: string;
  private_key?: string | null;
  password?: string | null;
  shutdown_cmd: string;
  ups_cmd?: string | null;
  node_order: number;
  enabled: number;
}

export function getNodes(): SwarmNode[] {
  return db.prepare<[], SwarmNode>('SELECT * FROM nodes ORDER BY node_order ASC').all();
}

export function upsertNode(node: SwarmNode): SwarmNode {
  // better-sqlite3 requires null (not undefined) for nullable columns
  const safe = {
    ...node,
    private_key: node.private_key ?? null,
    password:    node.password    ?? null,
    ups_cmd:     node.ups_cmd     ?? null,
  };

  if (safe.id) {
    db.prepare(`
      UPDATE nodes SET name=@name, host=@host, port=@port, user=@user,
        private_key=@private_key, password=@password, shutdown_cmd=@shutdown_cmd,
        ups_cmd=@ups_cmd, node_order=@node_order, enabled=@enabled
      WHERE id=@id
    `).run(safe);
    return safe;
  } else {
    const info = db.prepare(`
      INSERT INTO nodes (name, host, port, user, private_key, password, shutdown_cmd, ups_cmd, node_order, enabled)
      VALUES (@name, @host, @port, @user, @private_key, @password, @shutdown_cmd, @ups_cmd, @node_order, @enabled)
    `).run(safe);
    return { ...safe, id: Number(info.lastInsertRowid) };
  }
}

export function deleteNode(id: number): void {
  db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
}

export default db;
