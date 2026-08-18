#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  CGH SCADA Backend — Instalador Linux/macOS
#  Uso: bash install.sh
# ═══════════════════════════════════════════════════════════
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[AVISO]${NC} $1"; }
error() { echo -e "${RED}[ERRO]${NC} $1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     CGH SCADA Backend — Instalador       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Verificar Node.js ────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 18 ]; then
    info "Node.js $(node -v) encontrado ✓"
  else
    warn "Node.js $(node -v) muito antigo (mínimo v18). Instalando versão LTS..."
    INSTALL_NODE=true
  fi
else
  warn "Node.js não encontrado. Instalando..."
  INSTALL_NODE=true
fi

if [ "${INSTALL_NODE}" = "true" ]; then
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
  elif command -v brew &>/dev/null; then
    brew install node@20
  else
    error "Gerenciador de pacotes não reconhecido. Instale Node.js 20+ manualmente: https://nodejs.org"
  fi
  info "Node.js $(node -v) instalado ✓"
fi

# ── 2. Instalar dependências npm ────────────────────────────
info "Instalando dependências npm..."
npm install
info "Dependências instaladas ✓"

# ── 3. Configurar systemd (Linux) ───────────────────────────
INSTALL_DIR=$(pwd)
if command -v systemctl &>/dev/null && [ "$(uname)" = "Linux" ]; then
  info "Configurando serviço systemd..."
  cat > /tmp/cgh-scada.service << EOF
[Unit]
Description=CGH SCADA Backend
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(which node) ${INSTALL_DIR}/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
  sudo mv /tmp/cgh-scada.service /etc/systemd/system/cgh-scada.service
  sudo systemctl daemon-reload
  sudo systemctl enable cgh-scada
  info "Serviço systemd configurado ✓"
  echo ""
  echo "  Iniciar agora:     sudo systemctl start cgh-scada"
  echo "  Ver status:        sudo systemctl status cgh-scada"
  echo "  Ver logs:          sudo journalctl -u cgh-scada -f"
  echo ""
fi

# ── 4. Criar atalhos de execução ────────────────────────────
cat > start-simulate.sh << 'EOF'
#!/bin/bash
echo "[CGH SCADA] Iniciando em modo SIMULADOR..."
node server.js --simulate
EOF
chmod +x start-simulate.sh

cat > start-production.sh << 'EOF'
#!/bin/bash
echo "[CGH SCADA] Iniciando em modo PRODUÇÃO..."
node server.js
EOF
chmod +x start-production.sh

info "Scripts de inicialização criados ✓"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║              INSTALAÇÃO CONCLUÍDA!                   ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Modo Simulador (sem CLPs reais):                    ║"
echo "║    ./start-simulate.sh                               ║"
echo "║                                                      ║"
echo "║  Modo Produção (com CLPs reais):                     ║"
echo "║    1. Edite config/plants.json com IPs dos CLPs      ║"
echo "║    2. ./start-production.sh                          ║"
echo "║                                                      ║"
echo "║  Dashboard: http://localhost:3001                    ║"
echo "║  API REST:  http://localhost:3001/api/data           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
