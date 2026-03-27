import { getSetting, getNodes, saveEvent } from './db';
import type { SwarmNode, EventSeverity } from './db';
import { execCommand } from './ssh';
import type { ApcUpsStatusProps } from './types';

// ── State ─────────────────────────────────────────────────────────────────────

let onBatterySince: number | null = null;
let node3Timer: ReturnType<typeof setTimeout> | null = null;
const shutdownDone = new Set<number>(); // node IDs already shut down this cycle

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseNum(val?: string): number {
  return val ? parseFloat(val) || 0 : 0;
}

function isEnabled(): boolean {
  return getSetting('automation_enabled', '0') === '1';
}

function logEvent(type: string, severity: EventSeverity, description: string, value?: string) {
  const event = saveEvent({ timestamp: Date.now(), type, severity, description, value });
  console.log(`[Automation] ${type}: ${description}`);
  // Import notify lazily to avoid circular deps
  import('./notifications').then(({ notify }) => notify(event)).catch(() => {});
  return event;
}

async function shutdownNode(node: SwarmNode, reason: string) {
  if (!node.id || shutdownDone.has(node.id)) return;
  shutdownDone.add(node.id!);
  logEvent(
    'NODE_SHUTDOWN',
    'warning',
    `Apagando ${node.name} (${node.host}) — ${reason}`,
    node.host,
  );
  try {
    await execCommand(node, node.shutdown_cmd);
    console.log(`[Automation] ${node.name} shutdown command sent`);
  } catch (err: any) {
    logEvent('NODE_SHUTDOWN_SKIPPED', 'warning', `Error apagando ${node.name}: ${err.message}`, node.host);
  }
}

async function sendUpsShutdown(node: SwarmNode) {
  const cmd = node.ups_cmd || 'sudo apccontrol powerout';
  logEvent('UPS_POWEROUT', 'critical', `Enviando comando de apagado al UPS via ${node.name}: ${cmd}`);
  try {
    await execCommand(node, cmd);
    console.log('[Automation] UPS shutdown command sent');
  } catch (err: any) {
    console.error('[Automation] UPS shutdown command failed:', err.message);
  }
}

// ── Main status handler ──────────────────────────────────────────────────────

export function onStatus(status: ApcUpsStatusProps) {
  if (!isEnabled()) return;

  const isOnBattery = (status.STATUS ?? '').includes('ONBATT');
  const isOnline    = (status.STATUS ?? '').includes('ONLINE');
  const bcharge     = parseNum(status.BCHARGE);

  const delay3min = parseInt(getSetting('node3_delay_minutes', '5'), 10) * 60_000;
  const node2pct  = parseInt(getSetting('node2_battery_pct',   '60'), 10);
  const node1pct  = parseInt(getSetting('node1_battery_pct',   '20'), 10);
  const upsNodeId = parseInt(getSetting('ups_powerout_node_id', '0'),  10);

  const nodes = getNodes().filter(n => n.enabled);

  // ── Power restored ────────────────────────────────────────────────────────
  if (isOnline && onBatterySince !== null) {
    onBatterySince = null;
    if (node3Timer) { clearTimeout(node3Timer); node3Timer = null; }
    shutdownDone.clear();
    return;
  }

  // ── On battery ────────────────────────────────────────────────────────────
  if (!isOnBattery) return;

  if (onBatterySince === null) {
    onBatterySince = Date.now();
  }

  // Node 3 (highest order): shut down after delay
  const node3 = nodes.find(n => n.node_order === 3);
  if (node3 && !shutdownDone.has(node3.id!) && !node3Timer) {
    const elapsed = Date.now() - onBatterySince;
    const remaining = delay3min - elapsed;
    if (remaining <= 0) {
      shutdownNode(node3, `${getSetting('node3_delay_minutes', '5')} min en batería`);
    } else {
      node3Timer = setTimeout(() => {
        node3Timer = null;
        if (onBatterySince !== null) { // still on battery
          shutdownNode(node3, `${getSetting('node3_delay_minutes', '5')} min en batería`);
        }
      }, remaining);
    }
  }

  // Node 2: shut down at battery threshold
  const node2 = nodes.find(n => n.node_order === 2);
  if (node2 && !shutdownDone.has(node2.id!) && bcharge <= node2pct && bcharge > 0) {
    shutdownNode(node2, `Batería al ${bcharge.toFixed(1)}% (umbral ${node2pct}%)`);
  }

  // Node 1 (last): shut down + UPS command
  const node1 = nodes.find(n => n.node_order === 1);
  if (node1 && !shutdownDone.has(node1.id!) && bcharge <= node1pct && bcharge > 0) {
    // Send UPS shutdown command first (so UPS powers off after node1 is down)
    const upsNode = upsNodeId ? nodes.find(n => n.id === upsNodeId) : node1;
    if (upsNode) sendUpsShutdown(upsNode);
    // Brief delay then shut down node1
    setTimeout(() => shutdownNode(node1, `Batería al ${bcharge.toFixed(1)}% (umbral ${node1pct}%)`), 5_000);
  }
}
