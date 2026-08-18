"""
Configurações do Gateway CGH
Volts Automação - Francisco Beltrão / PR

Edite este arquivo conforme o seu ambiente.
"""

# ─────────────────────────────────────────
# Broker MQTT (Mosquitto)
# ─────────────────────────────────────────
BROKER = {
    "host":    "192.168.1.100",   # IP do servidor com Mosquitto
    "porta":   1883,
    "usuario": "volts",
    "senha":   "senha_aqui",
}

# ─────────────────────────────────────────
# Intervalo de leitura Modbus (segundos)
# ─────────────────────────────────────────
INTERVALO_LEITURA_S = 2

# ─────────────────────────────────────────
# Plantas (CGHs)
# Adicione ou remova conforme necessário
# ─────────────────────────────────────────
PLANTAS = {
    "cgh_dario": {
        "ip":      "10.10.1.10",   # IP do CLP/inversor via Tailscale
        "porta":   502,
        "num_ugs": 2,
        "unit_id": 1,
    },
    "cgh_garcia": {
        "ip":      "10.10.2.10",
        "porta":   502,
        "num_ugs": 2,
        "unit_id": 1,
    },
    "cgh_folha_verde": {
        "ip":      "10.10.3.10",
        "porta":   502,
        "num_ugs": 2,
        "unit_id": 1,
    },
    "cgh_lourdes": {
        "ip":      "10.10.4.10",
        "porta":   502,
        "num_ugs": 1,
        "unit_id": 1,
    },
    "cgh_campo_bonito": {
        "ip":      "10.10.5.10",
        "porta":   502,
        "num_ugs": 2,
        "unit_id": 1,
    },
    "cgh_piramide": {
        "ip":      "10.10.6.10",
        "porta":   502,
        "num_ugs": 1,
        "unit_id": 1,
    },
}

# ─────────────────────────────────────────
# Mapa de registradores Modbus
#
# Ajuste os endereços conforme a documentação
# do seu CLP ou inversor.
#
# Estrutura esperada por UG (10 registradores):
#   base_ug + (ug-1) * offset_ug
#
#   [0] potencia_kw    × 10  (ex: 12505 = 1250.5 kW)
#   [1] tensao_v             (ex: 13800 = 13800 V)
#   [2] corrente_a     × 10  (ex: 523 = 52.3 A)
#   [3] frequencia_hz  × 100 (ex: 6001 = 60.01 Hz)
#   [4] fator_potencia × 1000(ex: 980 = 0.98)
#   [5] rpm
#   [6] nivel_montante_cm
#   [7] nivel_jusante_cm
#   [8] temp_mancal_c  × 10  (ex: 452 = 45.2 °C)
#   [9] status (bit flags)
#       bit 0 = em_operacao
#       bit 1 = disjuntor_fechado
#       bit 2 = em_alarme
#       bit 3 = em_falha
# ─────────────────────────────────────────
MAPA_REGISTRADORES = {
    "base_ug":   0,     # endereço do primeiro registrador da UG1
    "offset_ug": 10,    # quantos registradores por UG
    "count":     10,    # total a ler por vez
}

# ─────────────────────────────────────────
# Limites para alarmes automáticos
# ─────────────────────────────────────────
LIMITES_ALARME = {
    "temp_mancal_c_max":    80.0,
    "frequencia_hz_min":    58.0,
    "frequencia_hz_max":    62.0,
    "nivel_montante_cm_min": 50,
}
