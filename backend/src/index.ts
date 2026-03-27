/// <reference path="./types.d.ts" />
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import ApcAccess from 'apcaccess';
import 'dotenv/config';

import {
  saveHistory, getAllHistory,
  saveEvent, getEvents, getLastEventOfType,
  pruneOld,
  getAllSettings, setSetting,
  getPushSubscriptions, addPushSubscription, removePushSubscription,
  getNodes, upsertNode, deleteNode,
  type HistoryEntry, type UPSEvent, type EventSeverity,
} from './db';
import { ApcUpsStatusProps } from './types';
import { notify, vapidPublicKey, sendTestAlert, ALERT_TYPES } from './notifications';
import { onStatus as automationOnStatus } from './automation';
import { testConnection } from './ssh';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const UPS_IP = process.env.UPS_IP;
const UPS_PORT = parseInt(process.env.UPS_PORT!, 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS!, 10);
const HISTORY_INTERVAL_MS = 60_000; // 1 minute

// ── State ─────────────────────────────────────────────────────────────────────

const client = new ApcAccess();
let latestStatus: ApcUpsStatusProps | null = null;

let prevStatus: string | null = null;
let prevNumXfers: string | null = null;
let prevSelfTest: string | null = null;
let prevBcharge: number | null = null;
let lastHistoryTs = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseNum(val?: string): number {
  if (!val) return 0;
  return parseFloat(val) || 0;
}

function addEvent(type: string, severity: EventSeverity, description: string, value?: string): UPSEvent {
  const partial = { timestamp: Date.now(), type, severity, description, value };
  const event = saveEvent(partial);
  console.log(`[EVENT][${severity.toUpperCase()}] ${type}: ${description}`);
  broadcastJson({ type: 'event', data: event });
  // Send notification (non-blocking)
  notify(event).catch(() => {});
  return event;
}

function detectEvents(status: ApcUpsStatusProps) {
  const currentStatus = status.STATUS?.trim() ?? '';
  const currentNumXfers = status.NUMXFERS?.trim() ?? '0';
  const currentSelfTest = status.SELFTEST?.trim() ?? 'NO';
  const currentBcharge = parseNum(status.BCHARGE);
  const currentLinev = parseNum(status.LINEV);
  const lotrans = parseNum(status.LOTRANS);
  const hitrans = parseNum(status.HITRANS);

  // Status changes
  if (prevStatus !== null && prevStatus !== currentStatus) {
    if (currentStatus.includes('ONBATT')) {
      addEvent('TRANSFER_TO_BATTERY', 'critical', 'UPS pasó a funcionar con batería interna', currentStatus);
    } else if (currentStatus.includes('ONLINE') && prevStatus.includes('ONBATT')) {
      addEvent('TRANSFER_TO_LINE', 'info', 'UPS restauró la alimentación desde la red eléctrica', currentStatus);
    } else {
      addEvent('STATUS_CHANGE', 'warning', `Estado cambió de "${prevStatus}" a "${currentStatus}"`, currentStatus);
    }
  }

  // New power transfer
  if (prevNumXfers !== null && parseInt(currentNumXfers) > parseInt(prevNumXfers)) {
    const reason = status.LASTXFER ?? 'Razón desconocida';
    addEvent('POWER_TRANSFER', 'warning', `Transferencia detectada: ${reason}`, status.LASTXFER);
  }

  // Battery thresholds
  if (prevBcharge !== null) {
    if (prevBcharge >= 20 && currentBcharge < 20) {
      addEvent('BATTERY_LOW', 'critical', `Batería por debajo del 20% — ${currentBcharge.toFixed(1)}%`, `${currentBcharge}%`);
    } else if (prevBcharge < 20 && currentBcharge >= 20) {
      addEvent('BATTERY_RECOVERED', 'info', `Batería recuperada — ${currentBcharge.toFixed(1)}%`, `${currentBcharge}%`);
    }
    if (prevBcharge >= 50 && currentBcharge < 50) {
      addEvent('BATTERY_HALF', 'warning', `Batería al 50% — ${currentBcharge.toFixed(1)}%`, `${currentBcharge}%`);
    }
  }

  // Voltage out of range (dedup: only once per 5 min)
  const FIVE_MIN = 5 * 60_000;
  if (lotrans > 0 && hitrans > 0) {
    if (currentLinev < lotrans && currentLinev > 0) {
      const last = getLastEventOfType('VOLTAGE_LOW');
      if (!last || Date.now() - last.timestamp > FIVE_MIN) {
        addEvent('VOLTAGE_LOW', 'critical', `Voltaje de línea bajo: ${currentLinev.toFixed(1)}V (mín ${lotrans}V)`, `${currentLinev}V`);
      }
    } else if (currentLinev > hitrans) {
      const last = getLastEventOfType('VOLTAGE_HIGH');
      if (!last || Date.now() - last.timestamp > FIVE_MIN) {
        addEvent('VOLTAGE_HIGH', 'critical', `Voltaje de línea alto: ${currentLinev.toFixed(1)}V (máx ${hitrans}V)`, `${currentLinev}V`);
      }
    }
  }

  // Self-test result
  if (prevSelfTest !== null && prevSelfTest !== currentSelfTest && currentSelfTest !== 'NO') {
    const sev: EventSeverity = currentSelfTest === 'OK' ? 'info' : 'warning';
    addEvent('SELF_TEST', sev, `Auto-prueba completada: ${currentSelfTest}`, currentSelfTest);
  }

  prevStatus = currentStatus;
  prevNumXfers = currentNumXfers;
  prevSelfTest = currentSelfTest;
  prevBcharge = currentBcharge;
}

function takeHistorySnapshot(status: ApcUpsStatusProps) {
  const now = Date.now();
  if (now - lastHistoryTs < HISTORY_INTERVAL_MS) return;
  lastHistoryTs = now;

  const entry: Omit<HistoryEntry, 'id'> = {
    timestamp: now,
    bcharge: parseNum(status.BCHARGE),
    loadpct: parseNum(status.LOADPCT),
    linev: parseNum(status.LINEV),
    battv: parseNum(status.BATTV),
    timeleft: parseNum(status.TIMELEFT),
    status: status.STATUS?.trim() ?? 'UNKNOWN',
  };
  saveHistory(entry);
  console.log(`[HISTORY] Snapshot saved at ${new Date(now).toISOString()}`);

  broadcastJson({ type: 'history_update', data: { ...entry, id: undefined } });

  // Prune old data once per hour (approx)
  if (Math.random() < 1 / 60) pruneOld();
}

// ── UPS Polling ───────────────────────────────────────────────────────────────

async function pollUPS() {
  try {
    if (!client.isConnected) {
      await client.connect(UPS_IP, UPS_PORT);
    }
    const status = await client.getStatusJson() as ApcUpsStatusProps;
    latestStatus = status;
    detectEvents(status);
    takeHistorySnapshot(status);
    automationOnStatus(status);
    broadcastJson({ type: 'status', data: status });
  } catch (err) {
    console.error('Error polling UPS:', err);
    if (client.isConnected) {
      try { await client.disconnect(); } catch (e) { /* ignore */ }
    }
  }
}

setInterval(pollUPS, POLL_INTERVAL_MS);
pollUPS();

// ── WebSocket ─────────────────────────────────────────────────────────────────

function broadcastJson(payload: object) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach((clientWs) => {
    if (clientWs.readyState === 1) clientWs.send(msg);
  });
}

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');

  if (latestStatus) {
    ws.send(JSON.stringify({ type: 'status', data: latestStatus }));
  }
  ws.send(JSON.stringify({ type: 'history', data: getAllHistory() }));
  ws.send(JSON.stringify({ type: 'events', data: getEvents() }));

  ws.on('close', () => console.log('Client disconnected'));
});

// ── Core REST Endpoints ───────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  if (!latestStatus) {
    res.status(503).json({ error: 'UPS data not yet available' });
    return;
  }
  res.json(latestStatus);
});

app.get('/api/history', (req, res) => {
  const hours = parseInt((req.query.hours as string) || '24', 10);
  const sinceMs = Date.now() - Math.min(hours, 24) * 60 * 60 * 1000;
  res.json(getAllHistory().filter((e: HistoryEntry) => e.timestamp >= sinceMs));
});

app.get('/api/events', (req, res) => {
  const limit = parseInt((req.query.limit as string) || '200', 10);
  res.json(getEvents(Math.min(limit, 500)));
});

// ── Settings endpoints ────────────────────────────────────────────────────────

app.get('/api/settings', (_req, res) => {
  res.json(getAllSettings());
});

app.post('/api/settings', (req, res) => {
  const updates: Record<string, string> = req.body;
  for (const [key, value] of Object.entries(updates)) {
    setSetting(key, String(value));
  }
  res.json({ ok: true });
});

// ── Nodes endpoints ───────────────────────────────────────────────────────────

app.get('/api/nodes', (_req, res) => {
  // Never expose credentials to the client
  const nodes = getNodes().map(n => ({ ...n, private_key: n.private_key ? '••••' : undefined, password: n.password ? '••••' : undefined }));
  res.json(nodes);
});

app.post('/api/nodes', (req, res) => {
  try {
    const node = upsertNode(req.body);
    res.json(node);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/nodes/:id', (req, res) => {
  deleteNode(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/nodes/:id/test-ssh', async (req, res) => {
  const nodes = getNodes();
  const node = nodes.find(n => n.id === Number(req.params.id));
  if (!node) { res.status(404).json({ error: 'Nodo no encontrado' }); return; }
  const result = await testConnection(node);
  res.json(result);
});

// ── Push endpoints ─────────────────────────────────────────────────────────────

app.get('/api/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: 'Invalid subscription' }); return;
  }
  addPushSubscription({ endpoint, p256dh: keys.p256dh, auth: keys.auth, created_at: Date.now() });
  res.json({ ok: true });
});

app.delete('/api/push/unsubscribe', (req, res) => {
  removePushSubscription(req.body.endpoint);
  res.json({ ok: true });
});

// ── Alert types (for UI) & test ───────────────────────────────────────────────

app.get('/api/alerts/types', (_req, res) => {
  res.json(ALERT_TYPES);
});

app.post('/api/alerts/test', async (_req, res) => {
  const results = await sendTestAlert();
  res.json({ results });
});

// ── Server ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3001', 10);
server.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT}`);
  console.log(`Polling UPS at ${UPS_IP}:${UPS_PORT} every ${POLL_INTERVAL_MS}ms`);
  console.log(`History snapshots every ${HISTORY_INTERVAL_MS / 1000}s`);
});
