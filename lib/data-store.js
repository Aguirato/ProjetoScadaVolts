'use strict';
const config  = require('../config/plants.json');
const EventEmitter = require('events');

class DataStore extends EventEmitter {

  constructor() {
    super();
    this.plants   = {};   // { plantId: { id, name, units: { ugId: {...state} } } }
    this.alarms   = [];   // alarm history (last 500)
    this.mwh      = {};   // { plantId_ugId: [jan..dec] }
    this._init();
  }

  _init() {
    config.plants.forEach(p => {
      this.plants[p.id] = { id: p.id, name: p.name, units: {} };
      p.units.forEach(u => {
        this.plants[p.id].units[u.id] = this._defaultState(p, u);
        this.mwh[`${p.id}_${u.id}`] = new Array(12).fill(0);
      });
    });
  }

  _defaultState(plant, unitCfg) {
    return {
      id:         unitCfg.id,
      rated_kw:   unitCfg.rated_kw,
      rated_v:    unitCfg.rated_v,
      ten_str:    unitCfg.ten_str,
      // status
      st:         'parada',
      online:     false,
      last_poll:  null,
      // analog
      pot:        0, vel: 0, freq: 0, ten: unitCfg.rated_v,
      dist:       0, fp: 0,
      pot_reativa:0, pot_aparente: 0,
      ia: 0, ib: 0, ic: 0,
      vexc: 0, iexc: 0,
      // temps
      fa: 25, fb: 25, fc: 25,
      mancal_esc: 25, mancal_ce: 25, mancal_lna: 25,
      vedacao: 25, temp_uhrv: 25, excitatriz: 25,
      // pressures
      pressao_oleo: 0, pressao_cond: 0, pressao_caixa: 0,
      // digital inputs
      dj_fechado: false, campo_ligado: false,
      borboleta_aberta: false, borboleta_fechada: true,
      bypass_aberto: false, bypass_fechada: true,
      mb1_ligada: false, mb1_defeito: false,
      mb2_ligada: false, mb2_defeito: false,
      nivel_alto: false, poco_sem_energia: false,
      automatico: true,
      bloqueio_86h: false, bloqueio_86m: false,
      bloqueio_86e: false, bloqueio_94p: false,
      valv_reposicao: false, motobomba_ligada: false,
      // alarms
      alm: 0,
      alm_list: [],
      // commands pending
      step: 0,
      // mwh
      mwh_today: 0,
      mwh_month: 0,
    };
  }

  /* ── READ ──────────────────────────────────────── */
  getUnit(plantId, ugId) {
    return this.plants[plantId]?.units[ugId] || null;
  }

  getAllForBroadcast() {
    return Object.values(this.plants).map(p => ({
      id:    p.id,
      name:  p.name,
      units: Object.values(p.units)
    }));
  }

  getMWH() {
    const result = {};
    Object.keys(this.mwh).forEach(k => { result[k] = this.mwh[k]; });
    return result;
  }

  /* ── WRITE ─────────────────────────────────────── */
  applyPollData(plantId, ugId, data) {
    const u = this.getUnit(plantId, ugId);
    if (!u) return;
    Object.assign(u, data);
    u.online    = true;
    u.last_poll = new Date().toISOString();
    // derive status from digital inputs
    if (data.status_trip)    u.st = 'trip';
    else if (data.status_gerando) u.st = 'gerando';
    else if (data.status_parada)  u.st = 'parada';
    // accumulate MWh
    const kwh_inc = (u.pot * (1/3600));  // poll is 1s → kWh
    u.mwh_today += kwh_inc / 1000;
    u.mwh_month += kwh_inc / 1000;
    const m = new Date().getMonth();
    this.mwh[`${plantId}_${ugId}`][m] = +(this.mwh[`${plantId}_${ugId}`][m] + kwh_inc/1000).toFixed(3);
    this.emit('data', { plantId, ugId });
  }

  setOffline(plantId, ugId) {
    const u = this.getUnit(plantId, ugId);
    if (!u) return;
    u.online = false;
    u.st = 'offline';
  }

  /* ── ALARMS ──────────────────────────────────── */
  addAlarm(plantId, ugId, message, severity = 'alarm') {
    const alarm = {
      id:       Date.now(),
      ts:       new Date().toISOString(),
      plantId, ugId, message, severity,
      acked:    false, ack_ts: null, ack_op: null
    };
    this.alarms.unshift(alarm);
    if (this.alarms.length > 500) this.alarms.pop();
    const u = this.getUnit(plantId, ugId);
    if (u) { u.alm++; u.alm_list.push(alarm); }
    this.emit('alarm', alarm);
    return alarm;
  }

  ackAlarm(alarmId, operator) {
    const a = this.alarms.find(x => x.id === alarmId);
    if (a && !a.acked) {
      a.acked = true; a.ack_ts = new Date().toISOString(); a.ack_op = operator;
    }
    return a;
  }

  ackAllAlarms(plantId, ugId, operator) {
    const u = this.getUnit(plantId, ugId);
    if (u) { u.alm = 0; u.alm_list = []; }
    this.alarms
      .filter(a => a.plantId === plantId && a.ugId === ugId && !a.acked)
      .forEach(a => { a.acked = true; a.ack_ts = new Date().toISOString(); a.ack_op = operator; });
  }

  registerParada(plantId, ugId, motivo, descricao, operador) {
    const u = this.getUnit(plantId, ugId);
    if (!u) return;
    u.stop_reason  = motivo;
    u.stop_desc    = descricao;
    u.stop_op      = operador;
    u.stop_ts      = new Date().toISOString();
  }
}

module.exports = new DataStore();
