@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════╗
echo ║     CGH SCADA Backend — Instalador       ║
echo ║               Windows                   ║
echo ╚══════════════════════════════════════════╝
echo.

:: ── 1. Verificar Node.js ─────────────────────────────────────
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [AVISO] Node.js nao encontrado.
    echo.
    echo Por favor instale Node.js 20 LTS em:
    echo   https://nodejs.org/en/download
    echo.
    echo Apos instalar, feche e reabra este prompt e execute install.bat novamente.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODEVER=%%i
echo [INFO] Node.js %NODEVER% encontrado ✓

:: ── 2. Instalar dependências npm ─────────────────────────────
echo [INFO] Instalando dependencias npm...
call npm install
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
)
echo [INFO] Dependencias instaladas ✓

:: ── 3. Criar scripts de inicialização ────────────────────────
echo @echo off > start-simulate.bat
echo echo [CGH SCADA] Iniciando em modo SIMULADOR... >> start-simulate.bat
echo node server.js --simulate >> start-simulate.bat
echo pause >> start-simulate.bat

echo @echo off > start-production.bat
echo echo [CGH SCADA] Iniciando em modo PRODUCAO... >> start-production.bat
echo node server.js >> start-production.bat
echo pause >> start-production.bat

echo [INFO] Scripts criados ✓

:: ── 4. Criar atalho na area de trabalho (opcional) ───────────
set SCRIPT_DIR=%~dp0
set DESKTOP=%USERPROFILE%\Desktop

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\shortcut.vbs"
echo sLinkFile = "%DESKTOP%\CGH SCADA.lnk" >> "%TEMP%\shortcut.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\shortcut.vbs"
echo oLink.TargetPath = "%SCRIPT_DIR%start-simulate.bat" >> "%TEMP%\shortcut.vbs"
echo oLink.WorkingDirectory = "%SCRIPT_DIR%" >> "%TEMP%\shortcut.vbs"
echo oLink.Description = "CGH SCADA Backend" >> "%TEMP%\shortcut.vbs"
echo oLink.Save >> "%TEMP%\shortcut.vbs"
cscript /nologo "%TEMP%\shortcut.vbs"
del "%TEMP%\shortcut.vbs"
echo [INFO] Atalho criado na area de trabalho ✓

echo.
echo ╔═══════════════════════════════════════════════════════╗
echo ║               INSTALAÇÃO CONCLUÍDA!                  ║
echo ╠═══════════════════════════════════════════════════════╣
echo ║  Modo Simulador (sem CLPs reais):                    ║
echo ║    start-simulate.bat                                ║
echo ║                                                      ║
echo ║  Modo Producao (com CLPs reais):                     ║
echo ║    1. Edite config\plants.json com IPs dos CLPs      ║
echo ║    2. start-production.bat                           ║
echo ║                                                      ║
echo ║  Dashboard: http://localhost:3001                    ║
echo ║  API REST:  http://localhost:3001/api/data           ║
echo ╚═══════════════════════════════════════════════════════╝
echo.
pause
