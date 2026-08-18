'use strict';
const ModbusRTU = require('modbus-serial');
const config    = require('../config/plants.json');
const store     = require('./data-store');

const MAP       = config.modbus_map;
const IR_MAP    = MAP.input_registers.map;
const DI_MAP    = MAP.discrete_inputs.map;
const COILS     = MAP.coils.commands;
const SP_MAP    = MAP.holding_setpoints.map;

const RECONNECT_MS = 5000;
const TIMEOUT_MS   = 2000;

class ModbusManager {

  constructor() {
    this.clients = {};  // key: "plantId_ugId" → { client, plantId, ugId, cfg, reconnTimer }
  }

  async start() {
    for (const plant of config.plants) {
      for (const unit of plant.units) {
        await this._connect(plant, unit);
      }
    }
  }

  async _connect(plant, unit) {
    const key = `${plant.id}_${unit.id}`;
    const plc = unit.plc;

    const client = new ModbusRTU();
    client.setTimeout(TIMEOUT_MS);

    this.clients[key] = { client, plantId: plant.id, ugId: unit.id, cfg: unit, connected: false };

    try {
      await client.connectTCP(plc.host, { port: plc.port });
      client.setID(plc.slave);
      this.clients[key].connected = true;
      console.log(`[Modbus] Conectado: ${plant.name} ${unit.id} → ${plc.host}:${plc.port}`);
    } catch (err) {
      console.warn(`[Modbus] Falha ${plant.name} ${unit.id}: ${err.message} — retry em ${RECONNECT_MS/1000}s`);
      store.setOffline(plant.id, unit.id);
      this._scheduleReconnect(plant, unit);
    }
  }

  _scheduleReconnect(plant, unit) {
    const key = `${plant.id}_${unit.id}`;
    const entry = this.clients[key];
    if (entry && entry.reconnTimer) clearTimeout(entry.reconnTimer);
    const timer = setTimeout(async () => {
      try { if (entry) entry.client.close(); } catch(_) {}
      await this._connect(plant, unit);
    }, RECONNECT_MS);
    if (entry) entry.reconnTimer = timer;
  }

  async pollAll() {
    for (const key of Object.keys(this.clients)) {
      const entry = this.clients[key];
      if (!entry.connected) continue;
      await this._pollUnit(entry);
    }
  }

  async _pollUnit(entry) {
    const { client, plantId, ugId, cfg } = entry;
    try {
      // ── Read Input Registers (FC3) ──────────────────
      const irCount = Object.keys(IR_MAP).length;
      const irData  = await client.readHoldingRegisters(MAP.input_registers.start_address, irCount);
      const data    = {};
      Object.keys(IR_MAP).forEach(idx => {
        const def = IR_MAP[idx];
        let raw = irData.data[parseInt(idx)];
        if (def.signed && raw > 32767) raw -= 65536;
        data[def.tag] = +(raw * def.factor).toFixed(4);
      });

      // ── Read Discrete Inputs (FC2) ─────────────────
      const diCount = Object.keys(DI_MAP).length;
      const diData  = await client.readDiscreteInputs(MAP.discrete_inputs.start_address, diCount);
      Object.keys(DI_MAP).forEach(idx => {
        data[DI_MAP[idx]] = diData.data[parseInt(idx)] ? true : false;
      });

      // Map to store fields
      const mapped = this._mapToStore(data, cfg);
      store.applyPollData(plantId, ugId, mapped);

    } catch (err) {
      console.warn(`[Modbus] Erro poll ${plantId} ${ugId}: ${err.message}`);
      entry.connected = false;
      store.setOffline(plantId, ugId);
      this._scheduleReconnect(
        config.plants.find(p => p.id === plantId),
        cfg
      );
    }
  }

  _mapToStore(d, cfg) {
    return {
      pot:            d.pot_ativa       || 0,
      pot_reativa:    d.pot_reativa     || 0,
      pot_aparente:   d.pot_aparente    || 0,
      fp:             d.fator_pot       || 0,
      ten:            d.tensao_a        || cfg.rated_v,
      ia:             d.corrente_a      || 0,
      ib:             d.corrente_b      || 0,
      ic:             d.corrente_c      || 0,
      vel:            d.velocidade      || 0,
      freq:           d.frequencia      || 0,
      dist:           d.distribuidor    || 0,
      vexc:           d.tensao_excitacao|| 0,
      iexc:           d.corrente_excitacao|| 0,
      fa:             d.temp_fase_a     || 25,
      fb:             d.temp_fase_b     || 25,
      fc:             d.temp_fase_c     || 25,
      mancal_esc:     d.temp_mancal_esc || 25,
      mancal_ce:      d.temp_mancal_ce  || 25,
      mancal_lna:     d.temp_mancal_lna || 25,
      vedacao:        d.temp_vedacao    || 25,
      temp_uhrv:      d.temp_uhrv       || 25,
      excitatriz:     d.temp_excitatriz || 25,
      pressao_oleo:   d.pressao_oleo    || 0,
      pressao_cond:   d.pressao_conduto || 0,
      pressao_caixa:  d.pressao_caixa   || 0,
      dj_fechado:     !!d.dj_fechado,
      campo_ligado:   !!d.campo_ligado,
      borboleta_aberta:  !!d.borboleta_aberta,
      borboleta_fechada: !!d.borboleta_fechada,
      bypass_aberto:     !!d.bypass_aberto,
      bypass_fechada:    !!d.bypass_fechada,
      mb1_ligada:     !!d.mb1_ligada,
      mb1_defeito:    !!d.mb1_defeito,
      mb2_ligada:     !!d.mb2_ligada,
      mb2_defeito:    !!d.mb2_defeito,
      nivel_alto:     !!d.nivel_alto,
      poco_sem_energia: !!d.poco_sem_energia,
      automatico:     !!d.automatico,
      bloqueio_86h:   !!d.bloqueio_86h,
      bloqueio_86m:   !!d.bloqueio_86m,
      bloqueio_86e:   !!d.bloqueio_86e,
      bloqueio_94p:   !!d.bloqueio_94p,
      valv_reposicao: !!d.valv_reposicao,
      motobomba_ligada: !!d.motobomba_ligada,
      status_gerando: !!d.status_gerando,
      status_parada:  !!d.status_parada,
      status_trip:    !!d.status_trip,
    };
  }

  /* ── COMMAND EXECUTION ─────────────────────────── */
  async sendCommand(plantId, ugId, command, value) {
    const key   = `${plantId}_${ugId}`;
    const entry = this.clients[key];
    if (!entry || !entry.connected) {
      throw new Error(`Unidade ${plantId} ${ugId} offline — comando não enviado`);
    }
    const { client } = entry;

    // Pulse coil command
    if (COILS[command] !== undefined) {
      const addr = MAP.coils.start_address + COILS[command];
      await client.writeCoil(addr, true);
      await new Promise(r => setTimeout(r, 200));
      await client.writeCoil(addr, false);
      console.log(`[Cmd] ${plantId} ${ugId} → ${command} (coil ${addr})`);
      return;
    }

    // Setpoint command
    if (SP_MAP[command] !== undefined) {
      const addr = SP_MAP[command];
      const raw  = Math.round((value || 0) * 10); // % × 10
      await client.writeRegister(addr, raw);
      console.log(`[Cmd] ${plantId} ${ugId} → ${command} = ${value}% (reg ${addr} = ${raw})`);
      return;
    }

    throw new Error(`Comando desconhecido: ${command}`);
  }
}

module.exports = new ModbusManager();
