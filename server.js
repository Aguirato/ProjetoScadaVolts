'use strict';
/**
 * CGH SCADA Backend — server.js
 * Inicia Express + WebSocket + polling Modbus + API REST
 * Uso: node server.js [--simulate]
 */

const path       = require('path');
const http       = require('http');
const express    = require('express');
const cors       = require('cors');
const { WebSocketServer } = require('ws');
const config     = require('./config/plants.json');
const store      = require('./lib/data-store');
const modbus     = require('./lib/modbus-manager');

const SIMULATE   = process.argv.includes('--simulate');
const PORT       = process.env.PORT || config.server.port || 3001;
const POLL_MS    = config.server.poll_ms || 1000;

// ─── Optional MQTT ──────────────────────────────────────────────────────────
let mqtt = null;
if (config.mqtt && config.mqtt.enabled) {
  try {
    const mqttLib = require('mqtt');
    mqtt = mqttLib.connect(config.mqtt.broker, {
      username: config.mqtt.username || undefined,
      password: config.mqtt.password || undefined,
      reconnectPeriod: 5000,
    });
    mqtt.on('connect', () => console.log('[MQTT] Conectado:', config.mqtt.broker));
    mqtt.on('error',   e  => console.warn('[MQTT] Erro:', e.message));

    // Subscribe to command topics
    mqtt.subscribe(`${config.mqtt.topic_root}/cmd/#`, err => {
      if (!err) console.log('[MQTT] Subscribed to commands');
    });
    mqtt.on('message', (topic, payload) => {
      try {
        const parts = topic.split('/');  // cgh/scada/cmd/{plant}/{ug}/{cmd}
        if (parts.length < 6) return;
        const [,, , plantId, ugId, command] = parts;
        const body = JSON.parse(payload.toString());
        executeCommand(plantId, ugId, command, body.value, body.operator || 'MQTT')
          .catch(e => console.warn('[MQTT Cmd]', e.message));
      } catch(e) {}
    });
  } catch(e) {
    console.warn('[MQTT] Módulo mqtt não instalado ou erro de conexão:', e.message);
  }
}

// ─── Alarm accumulator & broadcast ──────────────────────────────────────────
const previousDigitals = {}; // track changes to raise alarms

function checkAlarms(plantId, ugId, unit) {
  const key = `${plantId}_${ugId}`;
  const prev = previousDigitals[key] || {};

  const checks = [
    ['poco_sem_energia', 'Poço de Drenagem sem Energia', 'alarm'],
    ['nivel_alto',       'Nível Alto no Poço de Drenagem', 'alarm'],
    ['mb1_defeito',      'Defeito na Motobomba 1', 'alarm'],
    ['mb2_defeito',      'Defeito na Motobomba 2', 'alarm'],
    ['bloqueio_86h',     'Bloqueio 86H Atuado', 'trip'],
    ['bloqueio_86m',     'Bloqueio 86M Atuado', 'trip'],
    ['bloqueio_86e',     'Bloqueio 86E Atuado', 'trip'],
    ['bloqueio_94p',     'Bloqueio 94P Atuado', 'trip'],
  ];

  checks.forEach(([field, msg, sev]) => {
    if (unit[field] && !prev[field]) {
      const alarm = store.addAlarm(plantId, ugId, msg, sev);
      broadcastAlarm(alarm);
    }
  });

  // High temperature alarms
  const tempChecks = [
    ['fa','Temperatura Fase A Gerador', 85],
    ['fb','Temperatura Fase B Gerador', 85],
    ['fc','Temperatura Fase C Gerador', 85],
    ['mancal_esc','Temperatura Mancal TBN Escora', 80],
    ['mancal_ce', 'Temperatura Mancal TBN C.Escora', 80],
    ['mancal_lna','Temperatura Mancal TBN LNA', 80],
  ];
  tempChecks.forEach(([field, label, limit]) => {
    const prevKey = `temp_${field}`;
    if (unit[field] >= limit && (!prev[prevKey] || prev[prevKey] < limit)) {
      const alarm = store.addAlarm(plantId, ugId, `Alta Temperatura — ${label} (${unit[field].toFixed(1)}°C)`, 'alarm');
      broadcastAlarm(alarm);
    }
    previousDigitals[key] = previousDigitals[key] || {};
    previousDigitals[key][prevKey] = unit[field];
  });

  // Trip detection
  if (unit.st === 'trip' && prev.st !== 'trip') {
    const alarm = store.addAlarm(plantId, ugId, `TRIP — Unidade desarmada por proteção`, 'trip');
    broadcastAlarm(alarm);
  }

  previousDigitals[key] = { ...unit };
}

// ─── Express setup ──────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── REST API ─────────────────────────────────────────────────────────────────

// GET /api/data — snapshot completo
app.get('/api/data', (req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    simulate:  SIMULATE,
    plants: store.getAllForBroadcast(),
  });
});

// GET /api/alarms — histórico de alarmes
app.get('/api/alarms', (req, res) => {
  res.json({ ok: true, alarms: store.alarms.slice(0, 200) });
});

// POST /api/alarms/ack — reconhecer alarme
app.post('/api/alarms/ack', (req, res) => {
  const { alarmId, alarmIds, plantId, ugId, operator } = req.body;
  if (plantId && ugId) {
    store.ackAllAlarms(plantId, ugId, operator || 'Operador');
    broadcastAll();
    return res.json({ ok: true, message: 'Todos os alarmes reconhecidos' });
  }
  const ids = alarmIds || (alarmId ? [alarmId] : []);
  ids.forEach(id => store.ackAlarm(id, operator || 'Operador'));
  res.json({ ok: true, message: `${ids.length} alarme(s) reconhecido(s)` });
});

// POST /api/command — executar comando Modbus
app.post('/api/command', async (req, res) => {
  const { plantId, ugId, command, value, operator } = req.body;
  if (!plantId || !ugId || !command) {
    return res.status(400).json({ ok: false, message: 'plantId, ugId e command são obrigatórios' });
  }
  try {
    await executeCommand(plantId, ugId, command, value, operator || 'Dashboard');
    const msg = `Comando ${command} enviado para ${plantId} ${ugId}`;
    console.log(`[API] ${msg}`);
    broadcastAll();
    res.json({ ok: true, message: msg });
  } catch (err) {
    console.error(`[API] Erro comando: ${err.message}`);
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/parada — registrar parada com motivo
app.post('/api/parada', async (req, res) => {
  const { plantId, ugId, motivo, descricao, operador } = req.body;
  if (!plantId || !ugId || !motivo) {
    return res.status(400).json({ ok: false, message: 'plantId, ugId e motivo são obrigatórios' });
  }
  try {
    // 1. Envia comando PARAR via Modbus
    await executeCommand(plantId, ugId, 'PARAR', null, operador);
    // 2. Registra no store
    store.registerParada(plantId, ugId, motivo, descricao, operador);
    // 3. Loga como alarme com severidade info
    store.addAlarm(plantId, ugId, `Parada Registrada: ${motivo} — Op: ${operador}`, 'info');
    broadcastAll();
    res.json({ ok: true, message: `Parada registrada — ${plantId} ${ugId}` });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /api/mwh — acúmulo mensal
app.get('/api/mwh', (req, res) => {
  res.json({ ok: true, mwh: store.getMWH(), year: new Date().getFullYear() });
});

// GET /api/status — saúde do servidor
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    uptime:   Math.floor(process.uptime()),
    simulate: SIMULATE,
    clients:  wss.clients.size,
    version:  require('./package.json').version,
    ts:       new Date().toISOString(),
  });
});

// ─── WebSocket Server ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Cliente conectado: ${ip} — total: ${wss.clients.size}`);

  // Send full snapshot on connect
  ws.send(JSON.stringify({
    type:     'snapshot',
    simulate: SIMULATE,
    plants:   store.getAllForBroadcast(),
    alarms:   store.alarms.slice(0, 50),
    ts:       new Date().toISOString(),
  }));

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch(e) {}
  });

  ws.on('close', () => {
    console.log(`[WS] Cliente desconectado: ${ip} — restam: ${wss.clients.size}`);
  });
  ws.on('error', () => {});
});

function broadcast(data) {
  const str = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws.readyState === ws.OPEN) ws.send(str);
  });
}

function broadcastAll() {
  broadcast({
    type:   'data',
    plants: store.getAllForBroadcast(),
    ts:     new Date().toISOString(),
  });
}

function broadcastAlarm(alarm) {
  broadcast({ type: 'alarm', alarm });
  if (mqtt) mqtt.publish(`${config.mqtt.topic_root}/alarm`, JSON.stringify(alarm));
}

// ─── Command execution (Modbus or log in simulate) ──────────────────────────
async function executeCommand(plantId, ugId, command, value, operator) {
  if (SIMULATE) {
    // In simulate mode, commands are handled by the simulator's state
    // Just write to the modbus client (which connects to simulator)
  }
  await modbus.sendCommand(plantId, ugId, command, value);
  // Publish to MQTT if enabled
  if (mqtt) {
    mqtt.publish(`${config.mqtt.topic_root}/cmd_log`, JSON.stringify({
      ts: new Date().toISOString(), plantId, ugId, command, value, operator
    }));
  }
}

// ─── Main poll loop ──────────────────────────────────────────────────────────
async function pollLoop() {
  await modbus.pollAll();

  // Check alarms and broadcast
  config.plants.forEach(plant => {
    plant.units.forEach(unit => {
      const u = store.getUnit(plant.id, unit.id);
      if (u && u.online) checkAlarms(plant.id, unit.id, u);
    });
  });

  broadcastAll();

  // Publish to MQTT if enabled
  if (mqtt) {
    const data = store.getAllForBroadcast();
    data.forEach(plant => {
      plant.units.forEach(unit => {
        const topic = `${config.mqtt.topic_root}/${plant.id}/${unit.id}`;
        mqtt.publish(topic, JSON.stringify(unit));
      });
    });
  }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║       CGH SCADA Backend v1.0.0         ║');
  console.log('╚════════════════════════════════════════╝');

  if (SIMULATE) {
    console.log('[INFO] Modo SIMULADOR ativo — iniciando CLPs virtuais...');
    const { startSimulator } = require('./simulator');
    startSimulator();
    await new Promise(r => setTimeout(r, 500)); // aguarda simulador subir
  }

  console.log('[INFO] Conectando ao Modbus...');
  await modbus.start();

  // Start poll loop
  let polling = false;
  setInterval(async () => {
    if (polling) return;
    polling = true;
    try { await pollLoop(); } catch(e) { console.error('[Poll]', e.message); }
    polling = false;
  }, POLL_MS);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[INFO] Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`[INFO] Dashboard: http://localhost:${PORT}`);
    console.log(`[INFO] API REST:  http://localhost:${PORT}/api/data`);
    console.log(`[INFO] WebSocket: ws://localhost:${PORT}`);
    if (SIMULATE) console.log('[INFO] Simulando todos os CLPs localmente');
    console.log('[INFO] Pressione Ctrl+C para parar\n');
  });
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
