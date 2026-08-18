"""
Simulador de CGH - Testa o gateway sem hardware real
Volts Automação

Sobe um servidor Modbus TCP falso que responde com
valores realistas de uma CGH. Use para desenvolver e
testar o gateway sem precisar das plantas físicas.

Uso:
    pip install pymodbus
    python simulador.py

Depois rode o gateway apontando para 127.0.0.1:502
"""

import random
import time
import math
import threading
import logging

from pymodbus.server import StartTcpServer
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusSlaveContext,
    ModbusServerContext,
)

logging.basicConfig(level=logging.WARNING)
log = logging.getLogger("simulador")

# ─── Bloco de dados compartilhado ───────
store = ModbusSlaveContext(
    hr=ModbusSequentialDataBlock(0, [0] * 100)
)
context = ModbusServerContext(slaves=store, single=True)


def simular_valores():
    """Atualiza os registradores com valores realistas a cada 1 segundo."""
    t = 0
    while True:
        t += 1
        seno = math.sin(t / 30)  # variação suave

        for ug in range(2):
            base = ug * 10

            # Potência com variação ±5%
            potencia = int((1200 + seno * 60 + random.uniform(-10, 10)) * 10)
            tensao = 13800 + random.randint(-50, 50)
            corrente = int((52.0 + seno * 2.5) * 10)
            frequencia = int((60.00 + random.uniform(-0.05, 0.05)) * 100)
            fator_pot = int((0.97 + random.uniform(-0.01, 0.01)) * 1000)
            rpm = 360 + random.randint(-2, 2)
            nivel_mont = 320 + random.randint(-5, 5)
            nivel_jus = 85 + random.randint(-2, 2)
            temp_mancal = int((42.0 + seno * 3 + random.uniform(-0.5, 0.5)) * 10)

            # Status: bits 0 e 1 ativos (operando, disjuntor fechado)
            status = 0b0011

            regs = [
                potencia, tensao, corrente, frequencia,
                fator_pot, rpm, nivel_mont, nivel_jus,
                temp_mancal, status,
            ]

            store.setValues(3, base, regs)  # function code 3 = holding registers

        time.sleep(1)


def main():
    print("=" * 45)
    print("  Simulador Modbus TCP - CGH Volts")
    print("  Porta: 502 | 2 UGs simuladas")
    print("=" * 45)
    print("Configure o gateway com IP 127.0.0.1:502")
    print("Pressione Ctrl+C para encerrar\n")

    # Thread que atualiza os valores simulados
    t = threading.Thread(target=simular_valores, daemon=True)
    t.start()

    # Sobe servidor Modbus TCP
    StartTcpServer(context=context, address=("0.0.0.0", 502))


if __name__ == "__main__":
    main()
