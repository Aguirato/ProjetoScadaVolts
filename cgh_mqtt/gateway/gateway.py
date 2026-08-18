"""
Gateway Modbus TCP → MQTT
CGH - Pequenas Centrais Hidrelétricas
Volts Automação - Francisco Beltrão / PR

Lê registradores Modbus de cada planta e publica via MQTT.
Cada UG tem seus dados agrupados em um único payload JSON.
"""

import json
import logging
import time
import threading
from dataclasses import dataclass, field
from typing import Optional

import paho.mqtt.client as mqtt
from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusException

from config import BROKER, PLANTAS, MAPA_REGISTRADORES, INTERVALO_LEITURA_S

# ─────────────────────────────────────────
# Logging
# ─────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("logs/gateway.log"),
    ],
)
log = logging.getLogger("gateway")


# ─────────────────────────────────────────
# Estrutura de uma planta
# ─────────────────────────────────────────
@dataclass
class Planta:
    nome: str
    ip: str
    porta: int = 502
    num_ugs: int = 2
    unit_id: int = 1            # Modbus Unit ID (slave ID)
    online: bool = False
    erros_consecutivos: int = 0
    _modbus: Optional[ModbusTcpClient] = field(default=None, repr=False)

    def conectar_modbus(self) -> bool:
        try:
            self._modbus = ModbusTcpClient(self.ip, port=self.porta, timeout=3)
            ok = self._modbus.connect()
            if ok:
                log.info(f"[{self.nome}] Modbus TCP conectado em {self.ip}:{self.porta}")
            return ok
        except Exception as e:
            log.error(f"[{self.nome}] Falha ao conectar Modbus: {e}")
            return False

    def ler_registradores(self, endereco: int, count: int) -> Optional[list]:
        if not self._modbus or not self._modbus.is_socket_open():
            self.conectar_modbus()
        try:
            resp = self._modbus.read_holding_registers(
                address=endereco,
                count=count,
                slave=self.unit_id
            )
            if resp.isError():
                raise ModbusException(f"Resposta de erro Modbus: {resp}")
            return resp.registers
        except Exception as e:
            log.warning(f"[{self.nome}] Erro leitura reg {endereco}: {e}")
            return None

    def desconectar(self):
        if self._modbus:
            self._modbus.close()


# ─────────────────────────────────────────
# Cliente MQTT central
# ─────────────────────────────────────────
class ClienteMQTT:
    def __init__(self):
        self.client = mqtt.Client(
            client_id="gateway_cgh_volts",
            clean_session=False,        # mantém assinaturas após reconexão
        )
        self.client.username_pw_set(BROKER["usuario"], BROKER["senha"])
        self.client.on_connect    = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_publish    = self._on_publish

        # Last Will: avisa o dashboard se o gateway cair
        self.client.will_set(
            topic="gateway/status",
            payload=json.dumps({"online": False, "ts": time.time()}),
            qos=1,
            retain=True,
        )

        self._conectado = False

    def conectar(self):
        log.info(f"Conectando ao broker {BROKER['host']}:{BROKER['porta']}...")
        self.client.connect(
            host=BROKER["host"],
            port=BROKER["porta"],
            keepalive=60,
        )
        self.client.loop_start()

    def _on_connect(self, client, userdata, flags, rc):
        codigos = {
            0: "Conectado com sucesso",
            1: "Versão de protocolo inválida",
            2: "Client ID inválido",
            3: "Broker indisponível",
            4: "Usuário/senha incorretos",
            5: "Não autorizado",
        }
        if rc == 0:
            self._conectado = True
            log.info(f"MQTT: {codigos.get(rc)}")
            # Anuncia gateway online (retained)
            self.publicar(
                "gateway/status",
                {"online": True, "ts": time.time()},
                retain=True,
            )
        else:
            log.error(f"MQTT: {codigos.get(rc, f'rc={rc}')}")

    def _on_disconnect(self, client, userdata, rc):
        self._conectado = False
        if rc != 0:
            log.warning(f"MQTT desconectado inesperadamente (rc={rc}), reconectando...")

    def _on_publish(self, client, userdata, mid):
        log.debug(f"Mensagem publicada (mid={mid})")

    def publicar(self, topico: str, dados: dict, qos: int = 1, retain: bool = False):
        if not self._conectado:
            log.warning(f"MQTT offline, mensagem descartada: {topico}")
            return
        payload = json.dumps(dados, ensure_ascii=False)
        result = self.client.publish(topico, payload, qos=qos, retain=retain)
        if result.rc != mqtt.MQTT_ERR_SUCCESS:
            log.error(f"Erro ao publicar em {topico}: rc={result.rc}")

    def parar(self):
        self.publicar("gateway/status", {"online": False, "ts": time.time()}, retain=True)
        self.client.loop_stop()
        self.client.disconnect()
        log.info("MQTT desconectado.")


# ─────────────────────────────────────────
# Leitura e publicação de uma planta
# ─────────────────────────────────────────
def processar_planta(planta: Planta, mqtt_client: ClienteMQTT):
    """
    Loop de leitura de uma planta. Roda em thread separada.
    Lê os registradores de cada UG e publica no MQTT.
    """
    log.info(f"[{planta.nome}] Thread iniciada.")

    if not planta.conectar_modbus():
        log.error(f"[{planta.nome}] Não foi possível conectar. Thread encerrada.")
        mqtt_client.publicar(
            f"planta/{planta.nome}/status",
            {"online": False, "erro": "Falha Modbus TCP", "ts": time.time()},
            retain=True,
        )
        return

    # Anuncia planta online
    mqtt_client.publicar(
        f"planta/{planta.nome}/status",
        {"online": True, "ts": time.time()},
        retain=True,
    )

    while True:
        for ug in range(1, planta.num_ugs + 1):

            # Calcula endereço base de cada UG conforme mapa de registradores
            base = MAPA_REGISTRADORES["base_ug"] + (ug - 1) * MAPA_REGISTRADORES["offset_ug"]
            count = MAPA_REGISTRADORES["count"]

            regs = planta.ler_registradores(base, count)

            if regs is None:
                planta.erros_consecutivos += 1
                log.warning(f"[{planta.nome}] UG{ug}: erro #{planta.erros_consecutivos}")

                if planta.erros_consecutivos >= 5:
                    mqtt_client.publicar(
                        f"planta/{planta.nome}/status",
                        {
                            "online": False,
                            "erro": f"Sem resposta Modbus após {planta.erros_consecutivos} tentativas",
                            "ts": time.time(),
                        },
                        retain=True,
                    )
                    planta.erros_consecutivos = 0
                    planta.desconectar()
                    time.sleep(10)
                    planta.conectar_modbus()
                continue

            planta.erros_consecutivos = 0

            # ── Monta payload com todas as TAGs da UG ──
            payload = decodificar_registradores(regs, planta.nome, ug)

            # Medições contínuas → QoS 1
            mqtt_client.publicar(
                topic=f"planta/{planta.nome}/ug{ug}/medicoes",
                dados=payload,
                qos=1,
            )

            # Alarmes → QoS 2 (somente quando ativo)
            alarmes = verificar_alarmes(payload, planta.nome, ug)
            if alarmes:
                mqtt_client.publicar(
                    topic=f"planta/{planta.nome}/ug{ug}/alarmes",
                    dados=alarmes,
                    qos=2,
                )

            log.info(
                f"[{planta.nome}] UG{ug} | "
                f"P={payload['potencia_kw']:.1f}kW | "
                f"V={payload['tensao_v']}V | "
                f"I={payload['corrente_a']:.1f}A | "
                f"f={payload['frequencia_hz']:.2f}Hz"
            )

        time.sleep(INTERVALO_LEITURA_S)


# ─────────────────────────────────────────
# Decodificação dos registradores
# ─────────────────────────────────────────
def decodificar_registradores(regs: list, planta: str, ug: int) -> dict:
    """
    Converte os registradores brutos Modbus em valores engenharia.
    Ajuste os fatores de escala conforme o seu CLP/inversor.
    """
    return {
        # Identificação
        "planta":        planta,
        "ug":            ug,
        "ts":            time.time(),

        # Elétricas
        "potencia_kw":   regs[0] / 10.0,       # ex: 12505 → 1250.5 kW
        "tensao_v":      regs[1],               # V (valor direto)
        "corrente_a":    regs[2] / 10.0,        # ex: 523 → 52.3 A
        "frequencia_hz": regs[3] / 100.0,       # ex: 6001 → 60.01 Hz
        "fator_potencia": regs[4] / 1000.0,     # ex: 980 → 0.98

        # Mecânicas
        "rpm":           regs[5],
        "nivel_montante_cm": regs[6],           # cm
        "nivel_jusante_cm":  regs[7],           # cm

        # Temperatura
        "temp_mancal_c": regs[8] / 10.0,       # ex: 452 → 45.2 °C

        # Status (bit flags no registrador 9)
        "em_operacao":   bool(regs[9] & 0x01),
        "disjuntor_fechado": bool(regs[9] & 0x02),
        "em_alarme":     bool(regs[9] & 0x04),
        "em_falha":      bool(regs[9] & 0x08),
    }


# ─────────────────────────────────────────
# Verificação de alarmes
# ─────────────────────────────────────────
def verificar_alarmes(dados: dict, planta: str, ug: int) -> Optional[dict]:
    """Retorna dict de alarmes se houver algum ativo, senão None."""
    alarmes = []

    if dados.get("em_falha"):
        alarmes.append("FALHA_GERAL")
    if dados.get("em_alarme"):
        alarmes.append("ALARME_ATIVO")
    if dados.get("temp_mancal_c", 0) > 80:
        alarmes.append(f"TEMP_ALTA: {dados['temp_mancal_c']}°C")
    if dados.get("frequencia_hz", 60) < 58 or dados.get("frequencia_hz", 60) > 62:
        alarmes.append(f"FREQUENCIA_FORA: {dados['frequencia_hz']}Hz")
    if dados.get("nivel_montante_cm", 999) < 50:
        alarmes.append(f"NIVEL_BAIXO: {dados['nivel_montante_cm']}cm")

    if not alarmes:
        return None

    return {
        "planta":   planta,
        "ug":       ug,
        "alarmes":  alarmes,
        "ts":       time.time(),
    }


# ─────────────────────────────────────────
# Ponto de entrada
# ─────────────────────────────────────────
def main():
    log.info("=" * 50)
    log.info("  Gateway CGH - Volts Automação")
    log.info("=" * 50)

    mqtt_client = ClienteMQTT()
    mqtt_client.conectar()
    time.sleep(2)  # aguarda conexão MQTT estabilizar

    threads = []
    for nome, cfg in PLANTAS.items():
        planta = Planta(
            nome=nome,
            ip=cfg["ip"],
            porta=cfg.get("porta", 502),
            num_ugs=cfg.get("num_ugs", 2),
            unit_id=cfg.get("unit_id", 1),
        )
        t = threading.Thread(
            target=processar_planta,
            args=(planta, mqtt_client),
            name=f"thread_{nome}",
            daemon=True,
        )
        t.start()
        threads.append(t)
        time.sleep(0.5)  # pequeno delay entre plantas

    log.info(f"{len(threads)} plantas iniciadas. Gateway rodando...")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Encerrando gateway...")
        mqtt_client.parar()


if __name__ == "__main__":
    main()
