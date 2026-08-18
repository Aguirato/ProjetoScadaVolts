"""
Monitor MQTT - CGH
Volts Automação

Assina todos os tópicos das plantas e exibe no terminal.
Útil para debug e verificação do gateway.

Uso:
    python monitor.py
    python monitor.py --topico planta/cgh_dario/#
    python monitor.py --topico planta/+/ug1/medicoes
"""

import json
import argparse
import logging
from datetime import datetime

import paho.mqtt.client as mqtt
from config import BROKER

logging.basicConfig(
    level=logging.WARNING,  # silencia logs internos do paho
    format="%(message)s",
)


def formatar_medicoes(dados: dict) -> str:
    ts = datetime.fromtimestamp(dados.get("ts", 0)).strftime("%H:%M:%S")
    return (
        f"  ┌─ {dados.get('planta','?').upper()} │ UG{dados.get('ug','?')} │ {ts}\n"
        f"  │  Potência:    {dados.get('potencia_kw', 0):>8.1f} kW\n"
        f"  │  Tensão:      {dados.get('tensao_v', 0):>8} V\n"
        f"  │  Corrente:    {dados.get('corrente_a', 0):>8.1f} A\n"
        f"  │  Frequência:  {dados.get('frequencia_hz', 0):>8.2f} Hz\n"
        f"  │  FP:          {dados.get('fator_potencia', 0):>8.3f}\n"
        f"  │  RPM:         {dados.get('rpm', 0):>8}\n"
        f"  │  Nível mont.: {dados.get('nivel_montante_cm', 0):>8} cm\n"
        f"  │  Temp. mancal:{dados.get('temp_mancal_c', 0):>8.1f} °C\n"
        f"  │  Em operação: {'✔' if dados.get('em_operacao') else '✘'}\n"
        f"  └─ Alarme: {'⚠ SIM' if dados.get('em_alarme') else 'Não'}"
        f"  │  Falha: {'⛔ SIM' if dados.get('em_falha') else 'Não'}"
    )


def on_connect(client, userdata, flags, rc):
    topico = userdata["topico"]
    if rc == 0:
        print(f"\n✅ Conectado ao broker {BROKER['host']}:{BROKER['porta']}")
        print(f"📡 Assinando: {topico}\n")
        client.subscribe(topico, qos=1)
    else:
        print(f"❌ Erro de conexão: rc={rc}")


def on_message(client, userdata, msg):
    topico = msg.topic
    try:
        dados = json.loads(msg.payload.decode())
    except json.JSONDecodeError:
        print(f"[{topico}] Payload inválido: {msg.payload}")
        return

    # Formata conforme o tipo de tópico
    if "/medicoes" in topico:
        print(formatar_medicoes(dados))
    elif "/alarmes" in topico:
        print(f"\n⚠️  ALARME │ {topico}")
        for a in dados.get("alarmes", []):
            print(f"   → {a}")
    elif "/status" in topico:
        status = "🟢 ONLINE" if dados.get("online") else "🔴 OFFLINE"
        print(f"\n{status} │ {topico}")
    else:
        print(f"\n[{topico}]\n{json.dumps(dados, indent=2, ensure_ascii=False)}")


def main():
    parser = argparse.ArgumentParser(description="Monitor MQTT - CGH")
    parser.add_argument(
        "--topico", "-t",
        default="planta/#",
        help="Tópico MQTT a assinar (padrão: planta/#)"
    )
    args = parser.parse_args()

    client = mqtt.Client(
        client_id="monitor_cgh",
        userdata={"topico": args.topico}
    )
    client.username_pw_set(BROKER["usuario"], BROKER["senha"])
    client.on_connect = on_connect
    client.on_message = on_message

    print(f"Conectando a {BROKER['host']}:{BROKER['porta']}...")
    client.connect(BROKER["host"], BROKER["porta"])

    try:
        client.loop_forever()
    except KeyboardInterrupt:
        print("\nMonitor encerrado.")
        client.disconnect()


if __name__ == "__main__":
    main()
