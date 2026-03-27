import { Resend } from 'resend';
import webpush from 'web-push';
import {
  getSetting, setSetting,
  getPushSubscriptions, removePushSubscription,
} from './db';
import type { UPSEvent, EventSeverity } from './db';

// ── VAPID key bootstrap ────────────────────────────────────────────────────────

function ensureVapidKeys() {
  let pub = getSetting('vapid_public_key');
  let priv = getSetting('vapid_private_key');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    setSetting('vapid_public_key', pub);
    setSetting('vapid_private_key', priv);
    console.log('[Push] Generated new VAPID key pair');
  }
  webpush.setVapidDetails(
    'mailto:admin@example.com',
    pub,
    priv,
  );
  return pub;
}

export const vapidPublicKey = ensureVapidKeys();

// ── Alert type definitions ────────────────────────────────────────────────────

export const ALERT_TYPES = [
  'TRANSFER_TO_BATTERY',
  'TRANSFER_TO_LINE',
  'BATTERY_LOW',
  'BATTERY_HALF',
  'BATTERY_80',
  'BATTERY_RECOVERED',
  'VOLTAGE_LOW',
  'VOLTAGE_HIGH',
  'SELF_TEST',
  'NODE_SHUTDOWN',
  'NODE_SHUTDOWN_SKIPPED',
  'UPS_POWEROUT',
  'STATUS_CHANGE',
  'POWER_TRANSFER',
] as const;

export type AlertType = typeof ALERT_TYPES[number];

// ── Default toggles ───────────────────────────────────────────────────────────

const ALERT_DEFAULTS: Record<AlertType, { email: boolean; push: boolean; cooldown: number }> = {
  TRANSFER_TO_BATTERY:   { email: true,  push: true,  cooldown: 5  },
  TRANSFER_TO_LINE:      { email: true,  push: true,  cooldown: 5  },
  BATTERY_LOW:           { email: true,  push: true,  cooldown: 10 },
  BATTERY_HALF:          { email: true,  push: true,  cooldown: 10 },
  BATTERY_80:            { email: false, push: true,  cooldown: 10 },
  BATTERY_RECOVERED:     { email: true,  push: true,  cooldown: 10 },
  VOLTAGE_LOW:           { email: true,  push: true,  cooldown: 5  },
  VOLTAGE_HIGH:          { email: true,  push: true,  cooldown: 5  },
  SELF_TEST:             { email: false, push: false, cooldown: 60 },
  NODE_SHUTDOWN:         { email: true,  push: true,  cooldown: 1  },
  NODE_SHUTDOWN_SKIPPED: { email: false, push: false, cooldown: 1  },
  UPS_POWEROUT:          { email: true,  push: true,  cooldown: 1  },
  STATUS_CHANGE:         { email: false, push: false, cooldown: 10 },
  POWER_TRANSFER:        { email: false, push: false, cooldown: 10 },
};

// Cooldown tracking (in-memory, keyed by alert type)
const lastAlertSent: Partial<Record<AlertType, number>> = {};

// ── Severity → emoji ──────────────────────────────────────────────────────────

function severityEmoji(sev: EventSeverity) {
  if (sev === 'critical') return '🔴';
  if (sev === 'warning')  return '🟡';
  return '🟢';
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendEmail(subject: string, html: string) {
  const apiKey = getSetting('resend_api_key');
  if (!apiKey) return;

  const from  = getSetting('resend_from', 'APC UPS <noreply@example.com>');
  const toRaw = getSetting('resend_to', '');
  const to    = toRaw.split(',').map(e => e.trim()).filter(Boolean);
  if (!to.length) return;

  const resend = new Resend(apiKey);
  try {
    await resend.emails.send({ from, to, subject, html });
    console.log(`[Email] Sent: ${subject}`);
  } catch (err) {
    console.error('[Email] Failed:', err);
  }
}

// ── Push ──────────────────────────────────────────────────────────────────────

async function sendPush(title: string, body: string, badge?: string) {
  const subs = getPushSubscriptions();
  if (!subs.length) return;

  const payload = JSON.stringify({ title, body, badge: badge ?? '⚡' });
  const dead: string[] = [];

  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        dead.push(sub.endpoint);
      } else {
        console.error('[Push] Error sending to', sub.endpoint, err);
      }
    }
  }));

  dead.forEach(ep => removePushSubscription(ep));
  if (subs.length) console.log(`[Push] Sent to ${subs.length - dead.length} subscriber(s)`);
}

// ── Main notify function ───────────────────────────────────────────────────────

export async function notify(event: UPSEvent) {
  const type = event.type as AlertType;
  const defaults = ALERT_DEFAULTS[type];
  if (!defaults) return;

  // Cooldown check
  const cooldownMs = defaults.cooldown * 60_000;
  const last = lastAlertSent[type] ?? 0;
  if (Date.now() - last < cooldownMs) return;
  lastAlertSent[type] = Date.now();

  // Read per-type toggles (stored as "1"/"0", default to ALERT_DEFAULTS)
  const emailEnabled = getSetting(`alert_email_${type}`, defaults.email ? '1' : '0') === '1';
  const pushEnabled  = getSetting(`alert_push_${type}`,  defaults.push  ? '1' : '0') === '1';

  const emoji   = severityEmoji(event.severity);
  const subject = `${emoji} UPS Alert: ${event.description}`;
  const html    = `
    <div style="font-family: sans-serif; padding: 20px;">
      <h2>${emoji} ${event.description}</h2>
      <p><strong>Tipo:</strong> ${event.type}</p>
      <p><strong>Severidad:</strong> ${event.severity.toUpperCase()}</p>
      ${event.value ? `<p><strong>Valor:</strong> ${event.value}</p>` : ''}
      <p><strong>Hora:</strong> ${new Date(event.timestamp).toLocaleString('es-DO')}</p>
      <hr/>
      <p style="color:#888; font-size:12px;">APC UPS Monitor — Sistema automatizado</p>
    </div>
  `;

  if (emailEnabled) sendEmail(subject, html);
  if (pushEnabled)  sendPush(`${emoji} APC UPS`, event.description, emoji);
}

// ── Test alert ────────────────────────────────────────────────────────────────

export async function sendTestAlert() {
  const testEvent: UPSEvent = {
    id: 0,
    timestamp: Date.now(),
    type: 'TRANSFER_TO_BATTERY',
    severity: 'critical',
    description: '🧪 Alerta de prueba — El sistema funciona correctamente',
    value: 'TEST',
  };

  const apiKey = getSetting('resend_api_key');
  const subs   = getPushSubscriptions();

  const results: string[] = [];

  if (apiKey) {
    try {
      await sendEmail('🧪 Alerta de Prueba — APC UPS Monitor', `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>🧪 Alerta de prueba</h2>
          <p>Si recibes este correo, la integración con Resend está funcionando.</p>
          <p><strong>Hora:</strong> ${new Date().toLocaleString('es-DO')}</p>
        </div>
      `);
      results.push('Email enviado');
    } catch { results.push('Email falló'); }
  } else {
    results.push('Email: sin API key configurada');
  }

  if (subs.length > 0) {
    try {
      await sendPush('🧪 Prueba APC UPS', 'Las notificaciones push están funcionando', '🧪');
      results.push(`Push enviado a ${subs.length} dispositivo(s)`);
    } catch { results.push('Push falló'); }
  } else {
    results.push('Push: sin suscriptores registrados');
  }

  return results;
}
