# Gateway CGH — Modbus TCP → MQTT
**Volts Automação | Francisco Beltrão / PR**

Lê dados de CLPs/inversores via Modbus TCP e publica via MQTT.
Desenvolvido para as CGHs: Dário, Garcia, Folha Verde, Lourdes, Campo Bonito e Pirâmide.

---

## Estrutura

```
cgh_mqtt/
├── gateway/
│   ├── gateway.py      ← ponto de entrada principal
│   ├── config.py       ← IPs, porta broker, mapa de registradores
│   ├── monitor.py      ← monitor de tópicos no terminal
│   └── simulador.py    ← CLP falso para testes sem hardware
├── logs/               ← gerado automaticamente
└── requirements.txt
```

---

## Instalação

```bash
pip install -r requirements.txt
```

---

## Configuração

Edite `gateway/config.py`:

- `BROKER` → IP/porta/usuário/senha do Mosquitto
- `PLANTAS` → IP de cada CLP/inversor (via Tailscale)
- `MAPA_REGISTRADORES` → endereços Modbus do seu equipamento
- `INTERVALO_LEITURA_S` → frequência de leitura (padrão: 2s)

---

## Uso

### 1. Testar sem hardware (simulador)
```bash
# Terminal 1 — sobe CLP falso na porta 502
python gateway/simulador.py

# Terminal 2 — roda o gateway apontando para localhost
# (edite config.py: ip = "127.0.0.1")
python gateway/gateway.py

# Terminal 3 — monitora o que chega no MQTT
python gateway/monitor.py
```

### 2. Produção
```bash
python gateway/gateway.py
```

### 3. Monitor com tópico específico
```bash
python gateway/monitor.py --topico planta/cgh_dario/#
python gateway/monitor.py --topico planta/+/ug1/medicoes
python gateway/monitor.py --topico planta/+/alarmes
```

---

## Tópicos MQTT publicados

| Tópico | Conteúdo | QoS | Retain |
|--------|----------|-----|--------|
| `gateway/status` | `{"online": true}` | 1 | ✔ |
| `planta/{nome}/status` | `{"online": true}` | 1 | ✔ |
| `planta/{nome}/ug{n}/medicoes` | Todas as TAGs da UG | 1 | ✘ |
| `planta/{nome}/ug{n}/alarmes` | Lista de alarmes ativos | 2 | ✘ |

---

## Payload de medições (exemplo)

```json
{
  "planta":            "cgh_dario",
  "ug":                1,
  "ts":                1720000000.0,
  "potencia_kw":       1250.5,
  "tensao_v":          13800,
  "corrente_a":        52.3,
  "frequencia_hz":     60.01,
  "fator_potencia":    0.98,
  "rpm":               360,
  "nivel_montante_cm": 320,
  "nivel_jusante_cm":  85,
  "temp_mancal_c":     42.1,
  "em_operacao":       true,
  "disjuntor_fechado": true,
  "em_alarme":         false,
  "em_falha":          false
}
```

---

## Rodar como serviço (Linux)
********teste*********


Crie `/etc/systemd/system/cgh-gateway.service`:

```ini
[Unit]
Description=Gateway CGH Volts Automação
After=network.target mosquitto.service

[Service]
ExecStart=/usr/bin/python3 /opt/cgh_mqtt/gateway/gateway.py
WorkingDirectory=/opt/cgh_mqtt
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable cgh-gateway
sudo systemctl start cgh-gateway
sudo journalctl -u cgh-gateway -f
```
