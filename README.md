# CGH SCADA — Backend Completo
> Sistema supervisório para Centrais Geradoras Hidrelétricas  || VOLTS Automação Industrial LTDA
> Node.js · Modbus TCP/RTU · WebSocket · REST API · MQTT opcional

---

## 📋 Índice
1. [Visão Geral](#visão-geral)
2. [Requisitos](#requisitos)
3. [Instalação](#instalação)
4. [Configuração dos CLPs](#configuração-dos-clps)
5. [Mapa de Registros Modbus](#mapa-de-registros-modbus)
6. [Inicialização](#inicialização)
7. [Dashboard — Acesso](#dashboard--acesso)
8. [API REST — Referência](#api-rest--referência)
9. [Integração MQTT](#integração-mqtt)
10. [Execução em produção (serviço)](#execução-em-produção-serviço)
11. [Docker (opcional)](#docker-opcional)
12. [Solução de Problemas](#solução-de-problemas)

---

## Visão Geral

```
CLPs / RTUs (Modbus TCP ou RTU)
         │
         ▼
  ┌─────────────────────────────┐
  │     CGH SCADA Backend       │
  │  Node.js  ·  Express        │
  │  Modbus polling (1s)        │
  │  WebSocket broadcast        │
  │  REST API de comandos       │
  │  MQTT pub/sub (opcional)    │
  └─────────────────────────────┘
         │
         ▼
  Dashboard HTML (browser)
  · Dados ao vivo via WebSocket
  · Comandos via REST (fetch)
  · Abre em qualquer browser
  · Sem instalação no cliente
```

**Funcionalidades incluídas:**
- Leitura de todas as grandezas analógicas e digitais via Modbus TCP/RTU
- Envio de comandos: Partir, Parar, Excitar, Sincronizar, Fechar DJ, Emergência, Rearmar
- Controle de setpoint de potência ativa, reativa e tensão
- Gerenciamento de alarmes com reconhecimento
- Registro de paradas com motivo e operador
- Acúmulo de MWh por unidade e por mês
- Simulador embutido para testes sem CLPs reais
- MQTT opcional para integração com outros sistemas

---

## Requisitos

| Item | Versão mínima | Download |
|------|--------------|---------|
| Node.js | 18 LTS | https://nodejs.org |
| npm | 9+ | (incluso no Node.js) |
| SO | Windows 10 / Ubuntu 20 / Debian 11 / macOS 12 |
| Rede | Acesso TCP aos CLPs (porta Modbus, geralmente 502) |

> **CLPs suportados:** Qualquer equipamento com Modbus TCP ou Modbus RTU — WEG, Siemens, ABB, Schneider, Rockwell, Beckhoff, Arduino com biblioteca Modbus, etc.

---

## Instalação

### Linux / macOS

```bash
# 1. Extraia o arquivo zip
unzip cgh-scada.zip
cd cgh-scada

# 2. Execute o instalador
bash install.sh
```

O instalador verifica e instala o Node.js automaticamente e cria um serviço systemd (Linux).

### Windows

```
1. Extraia o arquivo cgh-scada.zip
2. Abra a pasta extraída
3. Dê dois cliques em install.bat
4. Siga as instruções na tela
```

> Se o Node.js não estiver instalado, o script abrirá o site para download. Instale e execute `install.bat` novamente.

### Instalação manual (qualquer SO)

```bash
cd cgh-scada
npm install
```

---

## Configuração dos CLPs

Edite o arquivo `config/plants.json` para apontar para os CLPs reais:

```json
{
  "plants": [
    {
      "id":   "dario",
      "name": "CGH DÁRIO",
      "units": [
        {
          "id":       "UG-01",
          "rated_kw": 1790,
          "rated_v":  440,
          "ten_str":  "440",
          "plc": {
            "host":  "192.168.1.10",  ← IP do CLP na rede
            "port":  502,              ← Porta Modbus TCP (padrão 502)
            "slave": 1                 ← Endereço Modbus slave (1-247)
          }
        }
      ]
    }
  ]
}
```

**Parâmetros do servidor:**
```json
"server": {
  "port":     3001,    ← Porta do servidor web/WebSocket
  "poll_ms":  1000     ← Intervalo de leitura dos CLPs (ms)
}
```

### Modbus RTU sobre Serial

Para CLPs com RS-485, use um conversor RS-485 → Ethernet (ex: USR-TCP232-410S, Moxa NPort)  
e configure o IP do conversor em `host`. O conversor translada Modbus TCP → RTU.

Para Modbus RTU direto via serial (COM/ttyUSB), altere `modbus-manager.js`:

```javascript
// Substitua:
await client.connectTCP(plc.host, { port: plc.port });
// Por:
await client.connectRTUBuffered('/dev/ttyUSB0', { baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 });
```

---

## Mapa de Registros Modbus

Configure no seu CLP para que os registros respondam nesta posição:

### Input / Holding Registers — FC03 (leitura de valores analógicos)

| Endereço | Tag | Fator | Unidade | Exemplo |
|----------|-----|-------|---------|---------|
| 40001 (0) | Potência Ativa | ×0.1 | kW | 18420 → 1842.0 kW |
| 40002 (1) | Potência Reativa | ×0.1 | kVAr | signed |
| 40003 (2) | Potência Aparente | ×0.1 | kVA | |
| 40004 (3) | Fator de Potência | ×0.001 | — | 989 → 0.989 |
| 40005 (4) | Tensão Fase A | ×0.1 | V | 4400 → 440.0 V |
| 40006 (5) | Tensão Fase B | ×0.1 | V | |
| 40007 (6) | Tensão Fase C | ×0.1 | V | |
| 40008 (7) | Corrente Fase A | ×0.1 | A | |
| 40009 (8) | Corrente Fase B | ×0.1 | A | |
| 40010 (9) | Corrente Fase C | ×0.1 | A | |
| 40011 (10) | Velocidade | ×0.1 | RPM | 3600 → 360.0 |
| 40012 (11) | Frequência | ×0.01 | Hz | 6000 → 60.00 |
| 40013 (12) | Distribuidor | ×0.1 | % | 720 → 72.0% |
| 40014 (13) | Tensão Excitação | ×0.1 | Vcc | |
| 40015 (14) | Corrente Excitação | ×0.1 | Acc | |
| 40016 (15) | Temp. Fase A Gerador | ×0.1 | °C | signed |
| 40017 (16) | Temp. Fase B Gerador | ×0.1 | °C | signed |
| 40018 (17) | Temp. Fase C Gerador | ×0.1 | °C | signed |
| 40019 (18) | Temp. Mancal TBN Escora | ×0.1 | °C | signed |
| 40020 (19) | Temp. Mancal TBN C.Escora | ×0.1 | °C | signed |
| 40021 (20) | Temp. Mancal TBN LNA | ×0.1 | °C | signed |
| 40022 (21) | Temp. Vedação Eixo | ×0.1 | °C | signed |
| 40023 (22) | Temp. UHRV | ×0.1 | °C | signed |
| 40024 (23) | Temp. Excitatriz | ×0.1 | °C | signed |
| 40025 (24) | Pressão Óleo UHRV | ×0.1 | bar | |
| 40026 (25) | Pressão Conduto | ×0.01 | bar | |
| 40027 (26) | Pressão Caixa | ×0.01 | bar | |
| 40101 (100) | Setpoint Pot. Ativa | ×0.1 | % | R/W |
| 40102 (101) | Setpoint Pot. Reativa | ×0.1 | % | R/W |
| 40103 (102) | Setpoint Tensão Ger. | ×0.1 | % | R/W |

### Discrete Inputs — FC02 (entradas digitais)

| Endereço | Tag | Descrição |
|----------|-----|-----------|
| 10001 (0) | status_gerando | UG em geração |
| 10002 (1) | status_parada | UG parada |
| 10003 (2) | status_trip | UG em trip |
| 10004 (3) | dj_fechado | Disjuntor de máquina fechado |
| 10005 (4) | campo_ligado | Chave de campo ligada |
| 10006 (5) | borboleta_aberta | Borboleta aberta |
| 10007 (6) | borboleta_fechada | Borboleta fechada |
| 10008 (7) | bypass_aberto | ByPass aberto |
| 10009 (8) | bypass_fechada | ByPass fechado |
| 10010 (9) | mb1_ligada | Motobomba 1 ligada |
| 10011 (10) | mb1_defeito | Motobomba 1 com defeito |
| 10012 (11) | mb2_ligada | Motobomba 2 ligada |
| 10013 (12) | mb2_defeito | Motobomba 2 com defeito |
| 10014 (13) | nivel_alto | Nível alto no poço |
| 10015 (14) | poco_sem_energia | Poço sem energia |
| 10016 (15) | automatico | Modo automático ativo |
| 10017 (16) | bloqueio_86h | Bloqueio 86H atuado |
| 10018 (17) | bloqueio_86m | Bloqueio 86M atuado |
| 10019 (18) | bloqueio_86e | Bloqueio 86E atuado |
| 10020 (19) | bloqueio_94p | Bloqueio 94P atuado |
| 10021 (20) | valv_reposicao | Válvula de reposição ligada |
| 10022 (21) | motobomba_ligada | Motobomba UHRV ligada |

### Coils — FC05 (saídas digitais — comandos)

> O backend envia um pulso (ON → 200ms → OFF) para cada comando.

| Endereço | Comando | Ação |
|----------|---------|------|
| 00001 (0) | PARAR | Para a unidade |
| 00002 (1) | UHRV | Liga o sistema UHRV |
| 00003 (2) | BORBOLETA | Abre a borboleta |
| 00004 (3) | RODAR | Inicia a rotação |
| 00005 (4) | EXCITAR | Excita o gerador |
| 00006 (5) | SINCRONIZAR | Sincroniza com a rede |
| 00007 (6) | FECHAR_DJ | Fecha o disjuntor |
| 00008 (7) | EMERGENCIA | Para de emergência |
| 00009 (8) | REARMAR | Rearma os bloqueios |

---

## Inicialização

### Modo Simulador (sem CLPs reais — para testes)

```bash
# Linux/macOS
./start-simulate.sh

# Windows
start-simulate.bat

# Direto com Node.js
node server.js --simulate
```

O simulador cria CLPs virtuais localmente, simula toda a física de uma UG (partida sequencial, flutuação de valores, trip, alarmes) e não requer nenhum hardware.

### Modo Produção (com CLPs reais)

```bash
# 1. Configure os IPs em config/plants.json
nano config/plants.json   # (Linux)
notepad config\plants.json  # (Windows)

# 2. Inicie
./start-production.sh   # Linux/macOS
start-production.bat    # Windows
node server.js          # Direto
```

---

## Dashboard — Acesso

Após iniciar o servidor, abra no browser:

```
http://localhost:3001
```

Para acessar de outro computador na mesma rede:

```
http://IP-DO-SERVIDOR:3001
```

O dashboard se conecta automaticamente via WebSocket. O indicador no canto superior direito mostra:
- 🟢 **Online** — conectado ao backend, dados reais
- 🔴 **Reconectando** — sem conexão, usando simulação local

---

## API REST — Referência

### GET `/api/data`
Retorna o estado atual de todas as plantas e UGs.

```bash
curl http://localhost:3001/api/data
```

### POST `/api/command`
Envia um comando Modbus para uma UG.

```bash
curl -X POST http://localhost:3001/api/command \
  -H "Content-Type: application/json" \
  -d '{"plantId":"dario","ugId":"UG-01","command":"RODAR"}'
```

**Comandos disponíveis:**
`PARAR` · `UHRV` · `BORBOLETA` · `RODAR` · `EXCITAR` · `SINCRONIZAR` · `FECHAR_DJ` · `EMERGENCIA` · `REARMAR`

**Setpoints (com `value`):**
```bash
curl -X POST http://localhost:3001/api/command \
  -d '{"plantId":"dario","ugId":"UG-01","command":"SETPOINT_POT","value":85}'
```

### POST `/api/parada`
Registra parada com motivo (também envia comando PARAR ao CLP).

```bash
curl -X POST http://localhost:3001/api/parada \
  -H "Content-Type: application/json" \
  -d '{
    "plantId":  "dario",
    "ugId":     "UG-01",
    "motivo":   "Manutenção Preventiva Programada",
    "descricao":"Troca de vedação do eixo",
    "operador": "João Silva"
  }'
```

### GET `/api/alarms`
Lista o histórico de alarmes (últimos 200).

### POST `/api/alarms/ack`
Reconhece alarmes.

```bash
# Todos os alarmes de uma UG
curl -X POST http://localhost:3001/api/alarms/ack \
  -d '{"plantId":"dario","ugId":"UG-01","operator":"Operador"}'
```

### GET `/api/mwh`
Retorna o acúmulo de MWh por unidade e por mês.

### GET `/api/status`
Retorna saúde do servidor (uptime, clientes WS, versão).

---

## Integração MQTT

Para habilitar a publicação em MQTT, edite `config/plants.json`:

```json
"mqtt": {
  "enabled": true,
  "broker":  "mqtt://192.168.1.200:1883",
  "username": "",
  "password": "",
  "topic_root": "cgh/scada"
}
```

**Tópicos publicados (a cada poll):**
```
cgh/scada/{plantId}/{ugId}   → JSON com todos os dados da UG
cgh/scada/alarm               → JSON do alarme quando gerado
cgh/scada/cmd_log             → Log de comandos executados
```

**Tópicos subscribed (comandos via MQTT):**
```
cgh/scada/cmd/{plantId}/{ugId}/{COMANDO}
```

Exemplo — parar UG-01 da Dário via MQTT:
```bash
mosquitto_pub -t "cgh/scada/cmd/dario/UG-01/PARAR" -m '{}'
```

### Instalar Mosquitto (MQTT Broker gratuito)

**Linux (Ubuntu/Debian):**
```bash
sudo apt install mosquitto mosquitto-clients
sudo systemctl enable --now mosquitto
```

**Windows:** https://mosquitto.org/download/

---

## Execução em produção (serviço)

### Linux — systemd (configurado pelo install.sh)

```bash
sudo systemctl start cgh-scada     # iniciar
sudo systemctl stop cgh-scada      # parar
sudo systemctl restart cgh-scada   # reiniciar
sudo systemctl status cgh-scada    # ver status
sudo journalctl -u cgh-scada -f    # ver logs em tempo real
```

### Windows — iniciar automaticamente com o Windows

```
1. Pressione Win+R, digite: shell:startup
2. Copie o arquivo start-production.bat para essa pasta
```

Ou use o NSSM (Non-Sucking Service Manager):
```
nssm install CGH-SCADA "node.exe" "C:\caminho\cgh-scada\server.js"
nssm start CGH-SCADA
```

---

## Docker (opcional)

```bash
# Iniciar com simulador
docker compose up -d

# Ver logs
docker compose logs -f scada

# Parar
docker compose down
```

Para modo produção, edite o `docker-compose.yml` e remova `--simulate` da linha `command`.

---

## Solução de Problemas

### Dashboard mostra "Reconectando..." (indicador vermelho)

- Verifique se o servidor Node.js está rodando
- Confirme que a porta 3001 não está bloqueada por firewall
- Teste: `curl http://localhost:3001/api/status`

### CLP não conecta (timeout)

- Verifique o IP e porta em `config/plants.json`
- Confirme que o CLP responde: `ping 192.168.1.10`
- Teste a porta Modbus: `nc -zv 192.168.1.10 502`
- Verifique o endereço Modbus slave (campo `slave`)

### Valores incorretos

- Verifique se o mapa de registros corresponde à configuração do seu CLP
- Confirme os fatores de escala (ex: se o CLP envia kW×1 ao invés de kW×10, ajuste `factor` em `config/plants.json`)
- Use um cliente Modbus externo para verificar os valores brutos (ex: Modbus Poll, QModMaster)

### Erro "Cannot find module 'modbus-serial'"

```bash
npm install   # execute na pasta do projeto
```

### Porta 3001 ocupada

Altere a porta em `config/plants.json`:
```json
"server": { "port": 8080 }
```

Ou use variável de ambiente:
```bash
PORT=8080 node server.js --simulate
```

---

## Estrutura de Arquivos

```
cgh-scada/
├── server.js              ← Servidor principal
├── simulator.js           ← Simulador de CLPs
├── package.json           ← Dependências npm
├── install.sh             ← Instalador Linux/macOS
├── install.bat            ← Instalador Windows
├── docker-compose.yml     ← Deploy Docker (opcional)
├── Dockerfile
├── config/
│   └── plants.json        ← Configuração das usinas e CLPs
├── lib/
│   ├── data-store.js      ← Estado em memória
│   └── modbus-manager.js  ← Polling e comandos Modbus
├── public/
│   └── dashboard-usinas.html  ← Dashboard web
└── mosquitto/
    └── mosquitto.conf     ← Config do broker MQTT
```

---

## Licença

MIT — uso livre, inclusive comercial.

---

*CGH SCADA Backend — desenvolvido para operação de Centrais Geradoras Hidrelétricas*
