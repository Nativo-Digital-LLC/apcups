import { useEffect, useState, useCallback } from 'react';
import {
  Tabs, Form, Input, Button, Switch, Table, Modal, Space,
  message, Tag, Divider, Alert, Tooltip, Select, InputNumber,
} from 'antd';
import {
  MailOutlined, BellOutlined, ApiOutlined, PlusOutlined,
  DeleteOutlined, CheckCircleOutlined,
  SendOutlined, PoweroffOutlined, QuestionCircleOutlined,
} from '@ant-design/icons';

const { TabPane } = Tabs;
const { TextArea } = Input;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Settings { [key: string]: string }

interface SwarmNode {
  id?: number;
  name: string;
  host: string;
  port: number;
  user: string;
  private_key?: string;
  password?: string;
  shutdown_cmd: string;
  ups_cmd?: string;
  node_order: number;
  enabled: number;
}

const ALERT_LABELS: Record<string, string> = {
  TRANSFER_TO_BATTERY: 'Corte eléctrico (a batería)',
  TRANSFER_TO_LINE: 'Restauración de energía',
  BATTERY_LOW: 'Batería baja (<20%)',
  BATTERY_HALF: 'Batería al 50%',
  BATTERY_80: 'Batería al 80%',
  BATTERY_RECOVERED: 'Batería recuperada',
  VOLTAGE_LOW: 'Voltaje de línea bajo',
  VOLTAGE_HIGH: 'Voltaje de línea alto',
  SELF_TEST: 'Auto-prueba del UPS',
  NODE_SHUTDOWN: 'Apagado de nodo',
  NODE_SHUTDOWN_SKIPPED: 'Error apagando nodo',
  UPS_POWEROUT: 'Apagado del UPS',
  STATUS_CHANGE: 'Cambio de estado',
  POWER_TRANSFER: 'Transferencia de energía',
};

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiGet(path: string) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiPost(path: string, body: unknown) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiDelete(path: string) {
  const r = await fetch(path, { method: 'DELETE' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Push helpers ──────────────────────────────────────────────────────────────

async function subscribePush(vapidPublicKey: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Tu navegador no soporta notificaciones push');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permiso denegado para notificaciones');

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
  });
  await apiPost('/api/push/subscribe', sub.toJSON());
  return sub;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [nodes, setNodes] = useState<SwarmNode[]>([]);
  const [alertTypes, setAlertTypes] = useState<string[]>([]);
  const [pushStatus, setPushStatus] = useState<'unknown' | 'granted' | 'denied' | 'not-supported'>('unknown');
  const [vapidKey, setVapidKey] = useState('');
  const [nodeModalOpen, setNodeModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<SwarmNode | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingNode, setTestingNode] = useState<number | null>(null);
  const [nodeForm] = Form.useForm();
  const [emailForm] = Form.useForm();
  const [autoForm] = Form.useForm();

  const load = useCallback(async () => {
    try {
      const [s, n, types, vapid] = await Promise.all([
        apiGet('/api/settings'),
        apiGet('/api/nodes'),
        apiGet('/api/alerts/types'),
        apiGet('/api/push/vapid-public-key'),
      ]);
      setSettings(s);
      setNodes(n);
      setAlertTypes(types);
      setVapidKey(vapid.publicKey);
      emailForm.setFieldsValue({
        resend_api_key: s.resend_api_key || '',
        resend_from: s.resend_from || '',
        resend_to: s.resend_to || '',
      });
      autoForm.setFieldsValue({
        automation_enabled: s.automation_enabled === '1',
        node3_delay_minutes: parseInt(s.node3_delay_minutes || '5', 10),
        node2_battery_pct: parseInt(s.node2_battery_pct || '60', 10),
        node1_battery_pct: parseInt(s.node1_battery_pct || '20', 10),
        ups_powerout_node_id: s.ups_powerout_node_id || '',
      });
    } catch (e: any) {
      message.error('Error cargando configuración: ' + e.message);
    }
    // Push status
    if (!('Notification' in window)) { setPushStatus('not-supported'); return; }
    if (Notification.permission === 'granted') setPushStatus('granted');
    else if (Notification.permission === 'denied') setPushStatus('denied');
  }, [emailForm, autoForm]);

  useEffect(() => { load(); }, [load]);

  // ── Save helpers ──────────────────────────────────────────────────────────

  const saveSettings = async (updates: Record<string, string>) => {
    setSaving(true);
    try {
      await apiPost('/api/settings', updates);
      setSettings(prev => ({ ...prev, ...updates }));
      message.success('Guardado');
    } catch (e: any) {
      message.error(e.message);
    } finally { setSaving(false); }
  };

  const saveEmailSettings = async (vals: Record<string, string>) => {
    await saveSettings({
      resend_api_key: vals.resend_api_key,
      resend_from: vals.resend_from,
      resend_to: vals.resend_to,
    });
  };

  const toggleAlert = (type: string, channel: 'email' | 'push', value: boolean) => {
    saveSettings({ [`alert_${channel}_${type}`]: value ? '1' : '0' });
  };

  // ── Push subscription ─────────────────────────────────────────────────────

  const handlePushSubscribe = async () => {
    try {
      await subscribePush(vapidKey);
      setPushStatus('granted');
      message.success('¡Notificaciones push activadas!');
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // ── Test alert ────────────────────────────────────────────────────────────

  const handleTestAlert = async () => {
    try {
      const res = await apiPost('/api/alerts/test', {});
      message.info(res.results.join(' · '));
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // ── Node CRUD ─────────────────────────────────────────────────────────────

  const openNodeModal = (node?: SwarmNode) => {
    setEditingNode(node || null);
    nodeForm.setFieldsValue(node || {
      port: 22, node_order: nodes.length + 1, enabled: 1,
      shutdown_cmd: 'sudo shutdown -h now',
    });
    setNodeModalOpen(true);
  };

  const handleNodeSave = async () => {
    const vals = await nodeForm.validateFields();
    // Merge: if password/key is '••••', don't overwrite
    const payload: SwarmNode = {
      ...(editingNode || {}),
      ...vals,
      enabled: vals.enabled ? 1 : 0,
      port: vals.port || 22,
    };
    if (vals.password === '••••') delete payload.password;
    if (vals.private_key === '••••') delete payload.private_key;
    try {
      await apiPost('/api/nodes', payload);
      message.success('Nodo guardado');
      setNodeModalOpen(false);
      load();
    } catch (e: any) { message.error(e.message); }
  };

  const handleNodeDelete = async (id: number) => {
    await apiDelete(`/api/nodes/${id}`);
    message.success('Nodo eliminado');
    load();
  };

  const handleTestSSH = async (id: number) => {
    setTestingNode(id);
    try {
      const res = await apiPost(`/api/nodes/${id}/test-ssh`, {});
      if (res.ok) message.success(res.message);
      else message.error(res.message);
    } catch (e: any) { message.error(e.message); }
    finally { setTestingNode(null); }
  };

  const saveAutomation = async (vals: Record<string, unknown>) => {
    await saveSettings({
      automation_enabled: vals.automation_enabled ? '1' : '0',
      node3_delay_minutes: String(vals.node3_delay_minutes),
      node2_battery_pct: String(vals.node2_battery_pct),
      node1_battery_pct: String(vals.node1_battery_pct),
      ups_powerout_node_id: String(vals.ups_powerout_node_id || ''),
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const nodeColumns = [
    { title: 'Orden', dataIndex: 'node_order', width: 70, render: (v: number) => <Tag color="blue">#{v}</Tag> },
    { title: 'Nombre', dataIndex: 'name' },
    { title: 'Host', dataIndex: 'host' },
    { title: 'Usuario', dataIndex: 'user' },
    {
      title: 'Estado',
      dataIndex: 'enabled',
      render: (v: number) => v ? <Tag color="green">Activo</Tag> : <Tag>Deshabilitado</Tag>,
    },
    {
      title: 'Acciones',
      render: (_: unknown, record: SwarmNode) => (
        <Space>
          <Button size="small" onClick={() => openNodeModal(record)}>Editar</Button>
          <Button
            size="small" icon={<ApiOutlined />} loading={testingNode === record.id}
            onClick={() => handleTestSSH(record.id!)}
          >
            Probar SSH
          </Button>
          <Button
            size="small" danger icon={<DeleteOutlined />}
            onClick={() => Modal.confirm({ title: `¿Eliminar ${record.name}?`, onOk: () => handleNodeDelete(record.id!) })}
          />
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Configuración</h1>
        <p className="text-gray-400">Alertas, notificaciones y automatización del UPS</p>
      </div>

      <div className="bg-surface rounded-xl border border-white/10 overflow-hidden">
        <Tabs defaultActiveKey="alerts" className="p-6" tabBarStyle={{ marginBottom: 24 }}>

          {/* ── ALERTS TAB ── */}
          <TabPane tab={<span><MailOutlined /> Alertas</span>} key="alerts">
            <div className="space-y-8">

              {/* Email */}
              <div>
                <h3 className="text-white font-semibold text-lg mb-4 flex items-center gap-2">
                  <MailOutlined /> Correo electrónico (Resend)
                </h3>
                <Form form={emailForm} layout="vertical" onFinish={saveEmailSettings}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Form.Item name="resend_api_key" label="API Key de Resend">
                      <Input.Password placeholder="re_xxxxxxxxxxxx" />
                    </Form.Item>
                    <Form.Item name="resend_from" label="Remitente (From)">
                      <Input placeholder="APC UPS <noreply@tudominio.com>" />
                    </Form.Item>
                    <Form.Item name="resend_to" label="Destinatarios (separa con comas)" className="md:col-span-2">
                      <Input placeholder="admin@empresa.com, ops@empresa.com" />
                    </Form.Item>
                  </div>
                  <Button type="primary" htmlType="submit" loading={saving} icon={<CheckCircleOutlined />}>
                    Guardar configuración de correo
                  </Button>
                </Form>
              </div>

              <Divider />

              {/* Push */}
              <div>
                <h3 className="text-white font-semibold text-lg mb-4 flex items-center gap-2">
                  <BellOutlined /> Notificaciones Push (este dispositivo)
                </h3>
                {pushStatus === 'not-supported' && (
                  <Alert type="warning" message="Tu navegador no soporta notificaciones push" showIcon />
                )}
                {pushStatus === 'denied' && (
                  <Alert type="error" message="Permiso denegado. Actívalas en la configuración del navegador." showIcon />
                )}
                {pushStatus === 'granted' && (
                  <Alert
                    type="success"
                    className="bg-green-500/10 border-green-500/20 text-green-100"
                    message="Notificaciones push activas en este dispositivo ✓"
                    showIcon />
                )}
                {pushStatus === 'unknown' && (
                  <Button type="default" icon={<BellOutlined />} onClick={handlePushSubscribe}>
                    Activar notificaciones push en este dispositivo
                  </Button>
                )}
              </div>

              <Divider />

              {/* Test */}
              <div>
                <Button type="default" icon={<SendOutlined />} onClick={handleTestAlert}>
                  Enviar alerta de prueba (email + push)
                </Button>
              </div>

              <Divider />

              {/* Toggles per event type */}
              <div>
                <h3 className="text-white font-semibold text-lg mb-4">Eventos configurados</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 border-b border-white/10">
                        <th className="text-left py-2 pr-4 font-medium">Evento</th>
                        <th className="text-center px-4 font-medium">Email</th>
                        <th className="text-center px-4 font-medium">Push</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alertTypes.map(type => (
                        <tr key={type} className="border-b border-white/5">
                          <td className="py-3 pr-4 text-gray-300">{ALERT_LABELS[type] || type}</td>
                          <td className="text-center px-4">
                            <Switch
                              size="small"
                              checked={(settings[`alert_email_${type}`] ?? (
                                ['TRANSFER_TO_BATTERY', 'TRANSFER_TO_LINE', 'BATTERY_LOW', 'BATTERY_HALF', 'VOLTAGE_LOW', 'VOLTAGE_HIGH', 'NODE_SHUTDOWN', 'UPS_POWEROUT'].includes(type) ? '1' : '0'
                              )) === '1'}
                              onChange={v => toggleAlert(type, 'email', v)}
                            />
                          </td>
                          <td className="text-center px-4">
                            <Switch
                              size="small"
                              checked={(settings[`alert_push_${type}`] ?? (
                                ['TRANSFER_TO_BATTERY', 'TRANSFER_TO_LINE', 'BATTERY_LOW', 'BATTERY_HALF', 'BATTERY_80', 'BATTERY_RECOVERED', 'VOLTAGE_LOW', 'VOLTAGE_HIGH', 'NODE_SHUTDOWN', 'UPS_POWEROUT'].includes(type) ? '1' : '0'
                              )) === '1'}
                              onChange={v => toggleAlert(type, 'push', v)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </TabPane>

          {/* ── AUTOMATION TAB ── */}
          <TabPane tab={<span><PoweroffOutlined /> Automatización</span>} key="automation">
            <div className="space-y-8">

              <Alert
                type="info"
                className="bg-blue-500/10 border-blue-500/20 text-blue-100"
                showIcon
                message="Apagado automático de nodos Swarm"
                description="Cuando hay un corte eléctrico, el sistema apagará los nodos en el orden configurado antes de que se agote la batería del UPS."
              />

              {/* Master toggle + thresholds */}
              <Form form={autoForm} layout="vertical" onFinish={saveAutomation}>
                <div className="flex items-center gap-3 mb-6">
                  <Form.Item name="automation_enabled" valuePropName="checked" noStyle>
                    <Switch />
                  </Form.Item>
                  <span className="text-white font-semibold">Automatización habilitada</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Form.Item
                    name="node3_delay_minutes"
                    label={<span className="text-gray-300">⏱️ Minutos antes de apagar Nodo 3 <Tooltip title="Tiempo de espera tras el corte antes de apagar el nodo de mayor orden"><QuestionCircleOutlined /></Tooltip></span>}
                  >
                    <InputNumber min={1} max={30} style={{ width: '100%' }} addonAfter="min" />
                  </Form.Item>
                  <Form.Item
                    name="node2_battery_pct"
                    label={<span className="text-gray-300">🔋 % para apagar Nodo 2</span>}
                  >
                    <InputNumber min={10} max={90} style={{ width: '100%' }} addonAfter="%" />
                  </Form.Item>
                  <Form.Item
                    name="node1_battery_pct"
                    label={<span className="text-gray-300">🔋 % para apagar Nodo 1 (+ UPS)</span>}
                  >
                    <InputNumber min={5} max={40} style={{ width: '100%' }} addonAfter="%" />
                  </Form.Item>
                </div>

                <Form.Item
                  name="ups_powerout_node_id"
                  label={<span className="text-gray-300">🔌 Nodo desde donde se apaga el UPS <Tooltip title="El nodo que ejecutará el comando apccontrol/ups_cmd antes de apagarse"><QuestionCircleOutlined /></Tooltip></span>}
                >
                  <Select placeholder="Usar Nodo 1 por defecto" allowClear style={{ maxWidth: 300 }}>
                    {nodes.map(n => <Select.Option key={n.id} value={String(n.id)}>{n.name} ({n.host})</Select.Option>)}
                  </Select>
                </Form.Item>

                <Button type="primary" htmlType="submit" loading={saving} icon={<CheckCircleOutlined />}>
                  Guardar configuración de automatización
                </Button>
              </Form>

              <Divider />

              {/* Nodes table */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold text-lg">Nodos Swarm</h3>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openNodeModal()}>
                    Añadir nodo
                  </Button>
                </div>
                <Table
                  dataSource={nodes}
                  columns={nodeColumns}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: 'No hay nodos configurados. Añade uno con el botón de arriba.' }}
                />
              </div>

              {/* Apagado secuencial diagram */}
              <div className="bg-black/20 rounded-lg p-4 font-mono text-sm text-gray-300">
                <p className="text-gray-500 mb-2">// Secuencia de apagado</p>
                <p>Corte eléctrico</p>
                <p className="pl-4">→ <span className="text-yellow-400">+{autoForm.getFieldValue('node3_delay_minutes') || 5} min</span> → Apagar <span className="text-red-400">Nodo 3</span></p>
                <p className="pl-4">→ Batería {'<'}<span className="text-yellow-400">{autoForm.getFieldValue('node2_battery_pct') || 60}%</span> → Apagar <span className="text-red-400">Nodo 2</span></p>
                <p className="pl-4">→ Batería {'<'}<span className="text-yellow-400">{autoForm.getFieldValue('node1_battery_pct') || 20}%</span> → Orden al UPS → Apagar <span className="text-red-400">Nodo 1</span></p>
                <p className="pl-4 text-green-400">→ Electricidad regresa → UPS enciende → Nodos arrancan via BIOS</p>
              </div>
            </div>
          </TabPane>
        </Tabs>
      </div>

      {/* Node Modal */}
      <Modal
        title={editingNode ? `Editar ${editingNode.name}` : 'Nuevo nodo Swarm'}
        open={nodeModalOpen}
        onOk={handleNodeSave}
        onCancel={() => setNodeModalOpen(false)}
        okText="Guardar"
        cancelText="Cancelar"
        width={600}
      >
        <Form form={nodeForm} layout="vertical" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="name" label="Nombre" rules={[{ required: true }]}>
              <Input placeholder="Nodo 1" />
            </Form.Item>
            <Form.Item name="node_order" label="Orden de apagado (1=último)" rules={[{ required: true }]}>
              <InputNumber min={1} max={10} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="host" label="Host / IP" rules={[{ required: true }]}>
              <Input placeholder="192.168.1.10" />
            </Form.Item>
            <Form.Item name="port" label="Puerto SSH">
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="user" label="Usuario SSH" rules={[{ required: true }]}>
              <Input placeholder="root" />
            </Form.Item>
            <Form.Item name="enabled" label="Habilitado" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <Form.Item name="password" label="Contraseña SSH (opcional si usa clave)">
            <Input.Password placeholder="Dejar vacío si usa clave privada" />
          </Form.Item>
          <Form.Item name="private_key" label="Clave privada SSH (PEM, opcional)">
            <TextArea rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..." />
          </Form.Item>
          <Form.Item name="shutdown_cmd" label="Comando de apagado">
            <Input placeholder="sudo shutdown -h now" />
          </Form.Item>
          <Form.Item name="ups_cmd" label={<span>Comando para apagar el UPS <Tooltip title="Solo se usa si este nodo es el seleccionado para el apagado del UPS. Vacío = no envía comando de UPS."><QuestionCircleOutlined /></Tooltip></span>}>
            <Input placeholder="sudo apccontrol powerout" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
