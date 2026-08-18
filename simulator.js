'use strict';
/**
 * Simulador Modbus TCP — CGH SCADA
 * Simula todos os CLPs das usinas para testes sem hardware real.
 * Cada UG tem uma porta TCP diferente (502, 503, 504...).
 * Executado automaticamente quando --simulate está ativo.
 */

const net     = require('net');
const config  = require('./config/plants.json');

// ─── UG state machine ────────────────────────────────────────────────────────
const STEPS = ['PARADA','UHRV','BORBOLETA','RODANDO','EXCITADO','SINCRONIZADO','GERANDO'];

function makeUGState(plantId, unitCfg) {
  const rated = unitCfg.rated_kw;
  return {
    plantId,
    ugId:        unitCfg.id,
    rated,
    rated_v:     unitCfg.rated_v,
    step:        0,   // 0=PARADA ... 6=GERANDO
    trip:        false,
    // analog (raw = real × factor)
    pot:         0,
    vel:         0,
    freq:        0,
    ten:         unitCfg.rated_v,
    dist:        0,
    fp:          0,
    pr:          0,
    pap:         0,
    ia:0, ib:0, ic:0, vexc:0, iexc:0,
    fa:25,fb:25,fc:25,
    mancal_esc:25, mancal_ce:25, mancal_lna:25,
    vedacao:25, temp_uhrv:25, excitatriz:25,
    pressao_oleo:0, pressao_cond:0, pressao_caixa:0,
    // digital
    dj_fechado:false, campo_ligado:false,
    borboleta_aberta:false, borboleta_fechada:true,
    bypass_aberto:false, bypass_fechada:true,
    mb1_ligada:false, mb1_defeito:false,
    mb2_ligada:false, mb2_defeito:false,
    nivel_alto:false, poco_sem_energia:false,
    automatico:true,
    bloqueio_86h:false, bloqueio_86m:false,
    bloqueio_86e:false, bloqueio_94p:false,
    valv_reposicao:false, motobomba_ligada:true,
    // transition
    transitionTs: 0,
    sp_pot: 100, sp_reat: 0, sp_ten: 100,
  };
}

function rnd(b, d) { return b + (Math.random()-0.5)*d; }

function tick(st) {
  if (st.trip) {
    st.pot=0; st.vel=0; st.freq=0; st.dist=0;
    st.dj_fechado=false; st.campo_ligado=false;
    return;
  }
  const now = Date.now();
  // auto-advance transitions
  if (st.step > 0 && st.step < 6 && (now - st.transitionTs) > 5000) {
    st.step++; st.transitionTs = now;
  }
  const g = st.step === 6;
  const r = st.step >= 3; // rotating

  if (g) {
    st.pot   = +rnd(st.rated * (st.sp_pot/100) * 0.95, st.rated*0.004).toFixed(1);
    st.vel   = +rnd(360, 0.2).toFixed(1);
    st.freq  = +rnd(60, 0.025).toFixed(2);
    st.ten   = +rnd(st.rated_v, st.rated_v*0.003).toFixed(0);
    st.dist  = +rnd(75, 0.4).toFixed(1);
    st.fp    = +rnd(0.985, 0.004).toFixed(3);
    st.pr    = +(-st.pot * 0.17).toFixed(1);
    st.pap   = +Math.sqrt(st.pot**2 + st.pr**2).toFixed(1);
    const base_i = st.rated * 1.3;
    st.ia = +rnd(base_i, base_i*0.003).toFixed(1);
    st.ib = +rnd(base_i, base_i*0.003).toFixed(1);
    st.ic = +rnd(base_i, base_i*0.003).toFixed(1);
    st.vexc = +rnd(82, 0.5).toFixed(1);
    st.iexc = +rnd(45, 0.3).toFixed(1);
    st.fa = +rnd(68, 0.5).toFixed(1);
    st.fb = +rnd(71, 0.5).toFixed(1);
    st.fc = +rnd(69, 0.5).toFixed(1);
    st.mancal_esc = +rnd(58, 0.3).toFixed(1);
    st.mancal_ce  = +rnd(54, 0.3).toFixed(1);
    st.mancal_lna = +rnd(52, 0.3).toFixed(1);
    st.vedacao     = +rnd(45, 0.2).toFixed(1);
    st.temp_uhrv   = +rnd(42, 0.2).toFixed(1);
    st.excitatriz  = +rnd(62, 0.3).toFixed(1);
    st.pressao_oleo = +rnd(148, 1).toFixed(1);
    st.pressao_cond = +rnd(4.8, 0.05).toFixed(2);
    st.pressao_caixa= +rnd(1.2, 0.03).toFixed(2);
    st.dj_fechado   = true; st.campo_ligado = true;
    st.borboleta_aberta=true; st.borboleta_fechada=false;
    st.bypass_aberto=false; st.bypass_fechada=true;
    st.motobomba_ligada=true;
    st.valv_reposicao=Math.random()<0.1;
  } else if (r) {
    st.vel  = +rnd(360*(st.step/6), 2).toFixed(1);
    st.freq = +rnd(60*(st.step/6), 0.5).toFixed(2);
    st.pot=0; st.dist=0; st.fp=0;
    st.ia=0;st.ib=0;st.ic=0;
    st.pressao_oleo=+rnd(148,1).toFixed(1);
  } else {
    st.pot=0; st.vel=0; st.freq=0; st.dist=0;
    st.pressao_oleo=st.step>=1?+rnd(148,1).toFixed(1):0;
    st.borboleta_aberta=false; st.borboleta_fechada=true;
  }
}

// ─── Modbus TCP frame parser & responder ────────────────────────────────────
function toInt16Raw(v) {
  const n = Math.round(v);
  return n < 0 ? n + 65536 : n;
}

function buildReply(tid, uid, fc, data) {
  const buf = Buffer.alloc(6 + data.length);
  buf.writeUInt16BE(tid,  0);  // transaction id
  buf.writeUInt16BE(0,    2);  // protocol
  buf.writeUInt16BE(data.length + 2, 4);
  buf[6] = uid; buf[7] = fc;
  data.copy(buf, 8);
  return buf;
}

function handleModbus(st, req) {
  const tid = req.readUInt16BE(0);
  const uid = req[6];
  const fc  = req[7];
  const addr= req.readUInt16BE(8);
  const qty = req.readUInt16BE(10);

  if (fc === 3) { // Read Holding Registers (input registers mapped here)
    const regs = [];
    for (let i = addr; i < addr + qty; i++) {
      switch(i) {
        case  0: regs.push(toInt16Raw(st.pot   * 10));  break;
        case  1: regs.push(toInt16Raw(st.pr    * 10));  break;
        case  2: regs.push(toInt16Raw(st.pap   * 10));  break;
        case  3: regs.push(toInt16Raw(st.fp    * 1000));break;
        case  4: regs.push(toInt16Raw(st.ten   * 10));  break;
        case  5: regs.push(toInt16Raw(st.ten   * 10));  break;
        case  6: regs.push(toInt16Raw(st.ten   * 10));  break;
        case  7: regs.push(toInt16Raw(st.ia    * 10));  break;
        case  8: regs.push(toInt16Raw(st.ib    * 10));  break;
        case  9: regs.push(toInt16Raw(st.ic    * 10));  break;
        case 10: regs.push(toInt16Raw(st.vel   * 10));  break;
        case 11: regs.push(toInt16Raw(st.freq  * 100)); break;
        case 12: regs.push(toInt16Raw(st.dist  * 10));  break;
        case 13: regs.push(toInt16Raw(st.vexc  * 10));  break;
        case 14: regs.push(toInt16Raw(st.iexc  * 10));  break;
        case 15: regs.push(toInt16Raw(st.fa    * 10));  break;
        case 16: regs.push(toInt16Raw(st.fb    * 10));  break;
        case 17: regs.push(toInt16Raw(st.fc    * 10));  break;
        case 18: regs.push(toInt16Raw(st.mancal_esc*10)); break;
        case 19: regs.push(toInt16Raw(st.mancal_ce *10)); break;
        case 20: regs.push(toInt16Raw(st.mancal_lna*10)); break;
        case 21: regs.push(toInt16Raw(st.vedacao   *10)); break;
        case 22: regs.push(toInt16Raw(st.temp_uhrv *10)); break;
        case 23: regs.push(toInt16Raw(st.excitatriz*10)); break;
        case 24: regs.push(toInt16Raw(st.pressao_oleo*10)); break;
        case 25: regs.push(toInt16Raw(st.pressao_cond*100));break;
        case 26: regs.push(toInt16Raw(st.pressao_caixa*100));break;
        // setpoint holding registers
        case 100: regs.push(st.sp_pot  *10); break;
        case 101: regs.push(st.sp_reat *10); break;
        case 102: regs.push(st.sp_ten  *10); break;
        default:  regs.push(0);
      }
    }
    const body = Buffer.alloc(1 + qty*2);
    body[0] = qty*2;
    regs.forEach((r,i) => body.writeUInt16BE(r, 1+i*2));
    return buildReply(tid, uid, fc, body);
  }

  if (fc === 2) { // Read Discrete Inputs
    const bools = [];
    for (let i = addr; i < addr + qty; i++) {
      switch(i) {
        case  0: bools.push(st.step===6&&!st.trip?1:0); break; // status_gerando
        case  1: bools.push(st.step===0&&!st.trip?1:0); break; // status_parada
        case  2: bools.push(st.trip?1:0);                break; // status_trip
        case  3: bools.push(st.dj_fechado?1:0);          break;
        case  4: bools.push(st.campo_ligado?1:0);         break;
        case  5: bools.push(st.borboleta_aberta?1:0);     break;
        case  6: bools.push(st.borboleta_fechada?1:0);    break;
        case  7: bools.push(st.bypass_aberto?1:0);        break;
        case  8: bools.push(st.bypass_fechada?1:0);       break;
        case  9: bools.push(st.mb1_ligada?1:0);           break;
        case 10: bools.push(st.mb1_defeito?1:0);          break;
        case 11: bools.push(st.mb2_ligada?1:0);           break;
        case 12: bools.push(st.mb2_defeito?1:0);          break;
        case 13: bools.push(st.nivel_alto?1:0);           break;
        case 14: bools.push(st.poco_sem_energia?1:0);     break;
        case 15: bools.push(st.automatico?1:0);           break;
        case 16: bools.push(st.bloqueio_86h?1:0);         break;
        case 17: bools.push(st.bloqueio_86m?1:0);         break;
        case 18: bools.push(st.bloqueio_86e?1:0);         break;
        case 19: bools.push(st.bloqueio_94p?1:0);         break;
        case 20: bools.push(st.valv_reposicao?1:0);       break;
        case 21: bools.push(st.motobomba_ligada?1:0);     break;
        default: bools.push(0);
      }
    }
    const bytes = Math.ceil(qty/8);
    const body  = Buffer.alloc(1+bytes, 0);
    body[0] = bytes;
    bools.forEach((b,i) => { if(b) body[1+Math.floor(i/8)] |= (1<<(i%8)); });
    return buildReply(tid, uid, fc, body);
  }

  if (fc === 5) { // Write Single Coil
    const val = req.readUInt16BE(10) === 0xFF00;
    if (val) applyCoilCommand(st, addr);
    const body = Buffer.from([addr>>8, addr&0xFF, val?0xFF:0x00, 0x00]);
    return buildReply(tid, uid, fc, body);
  }

  if (fc === 6) { // Write Single Register
    const val = req.readUInt16BE(10);
    if (addr === 100) st.sp_pot  = val/10;
    if (addr === 101) st.sp_reat = val/10;
    if (addr === 102) st.sp_ten  = val/10;
    const body = Buffer.from([addr>>8,addr&0xFF,val>>8,val&0xFF]);
    return buildReply(tid, uid, fc, body);
  }

  // Exception
  return buildReply(tid, uid, fc|0x80, Buffer.from([0x01]));
}

function applyCoilCommand(st, coilAddr) {
  switch(coilAddr) {
    case 0: // PARAR
      if (!st.bloqueio_86h&&!st.bloqueio_86m&&!st.bloqueio_86e&&!st.bloqueio_94p) {
        st.step=0; st.transitionTs=Date.now(); st.trip=false;
      } break;
    case 1: if(st.step===0){st.step=1;st.transitionTs=Date.now();} break; // UHRV
    case 2: if(st.step===1){st.step=2;st.transitionTs=Date.now();} break; // BORBOLETA
    case 3: if(st.step===2){st.step=3;st.transitionTs=Date.now();} break; // RODAR
    case 4: if(st.step===3){st.step=4;st.transitionTs=Date.now();} break; // EXCITAR
    case 5: if(st.step===4){st.step=5;st.transitionTs=Date.now();} break; // SINCRONIZAR
    case 6: if(st.step===5){st.step=6;st.transitionTs=Date.now();} break; // FECHAR DJ
    case 7: // EMERGENCIA
      st.step=0; st.trip=true;
      st.bloqueio_86h=Math.random()<0.5; st.bloqueio_86m=Math.random()<0.5;
      break;
    case 8: // REARMAR
      st.trip=false;
      st.bloqueio_86h=false; st.bloqueio_86m=false;
      st.bloqueio_86e=false;  st.bloqueio_94p=false;
      break;
  }
}

// ─── Start one TCP server per port ──────────────────────────────────────────
function startSimulator() {
  const PORT_BASE = 502;
  let portOffset = 0;
  const states = [];

  config.plants.forEach(plant => {
    plant.units.forEach(unitCfg => {
      const port = PORT_BASE + portOffset;
      portOffset++;

      // patch config so modbus-manager connects to localhost
      unitCfg.plc.host = '127.0.0.1';
      unitCfg.plc.port = port;

      const st = makeUGState(plant.id, unitCfg);
      states.push(st);

      const srv = net.createServer(socket => {
        socket.on('data', req => {
          try {
            if (req.length < 12) return;
            const reply = handleModbus(st, req);
            if (reply) socket.write(reply);
          } catch(e) { /* ignore malformed */ }
        });
        socket.on('error', () => {});
      });

      srv.listen(port, '127.0.0.1', () => {
        console.log(`[Sim] ${plant.name} ${unitCfg.id} → port ${port}`);
      });
      srv.on('error', err => console.error(`[Sim] Port ${port} error: ${err.message}`));
    });
  });

  // Tick all states every 500ms
  setInterval(() => states.forEach(tick), 500);
  console.log('[Sim] Simulador iniciado — todos os CLPs emulados localmente');
}

module.exports = { startSimulator };

// Run directly if called as main
if (require.main === module) {
  startSimulator();
  console.log('[Sim] Executando standalone. Use Ctrl+C para parar.');
}
