#!/usr/bin/env bash
# ==============================================================================
# KuraStream - Script de Configuración Todo-en-Uno para Debian (Sin Docker)
# Configura: Dependencias, MariaDB, .env, Servicio de arranque automático y Hotspot Wi-Fi
#
# Variables opcionales:
#   HOTSPOT_SSID      (por defecto: KuraStream-WiFi)
#   HOTSPOT_PASSWORD  (por defecto: kurastream2026, mínimo 8 caracteres)
#   SERVER_WORKERS    (por defecto: 16) procesos PHP simultáneos
# ==============================================================================
set -e

HOTSPOT_SSID="${HOTSPOT_SSID:-KuraStream-WiFi}"
HOTSPOT_PASSWORD="${HOTSPOT_PASSWORD:-kurastream2026}"
SERVER_WORKERS="${SERVER_WORKERS:-16}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

echo "=========================================================="
echo "  Iniciando instalación y configuración de KuraStream"
echo "=========================================================="

# 1. Dependencias del sistema
echo "[1/5] Instalando paquetes requeridos (PHP, MariaDB, FFmpeg, NetworkManager)..."
sudo apt-get update
sudo apt-get install -y php-cli php-mysql php-curl php-mbstring php-xml mariadb-server ffmpeg network-manager openssl

# 2. Archivo .env (config.php lo lee; sin él el servidor no arranca: falta JWT_SECRET y la clave de la BD)
echo "[2/5] Preparando configuración (.env)..."
env_value() {
    grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2-
}
if [ ! -f "$ENV_FILE" ]; then
    DB_PASSWORD="$(openssl rand -hex 16)"
    ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '/+=')"
    cat > "$ENV_FILE" <<EOF
PORT=3000
JWT_SECRET=$(openssl rand -hex 32)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=kurastream
DB_USER=kurastream
DB_PASS=$DB_PASSWORD
ADMIN_USER=admin
ADMIN_PASS=$ADMIN_PASSWORD
MEDIA_LIBRARY_PATH=./library
TMDB_API_KEY=
TMDB_READ_TOKEN=
EOF
    chmod 600 "$ENV_FILE"
    echo "  -> .env creado. Usuario admin: admin / Contraseña: $ADMIN_PASSWORD (cámbiala en .env)"
else
    echo "  -> Usando el .env existente."
fi
DB_NAME="$(env_value DB_NAME)"; DB_NAME="${DB_NAME:-kurastream}"
DB_USER="$(env_value DB_USER)"; DB_USER="${DB_USER:-kurastream}"
DB_PASSWORD="$(env_value DB_PASS)"
if [ -z "$DB_PASSWORD" ]; then
    echo "  [ERROR] DB_PASS está vacío en $ENV_FILE" >&2
    exit 1
fi

# 3. Configurar MariaDB
echo "[3/5] Configurando base de datos local MariaDB..."
sudo systemctl enable --now mariadb
sudo mariadb <<EOF
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
EOF

if [ -f "$SCRIPT_DIR/kurastream_data.sql" ]; then
    echo "  -> Importando catálogo y datos existentes desde kurastream_data.sql..."
    sudo mariadb "$DB_NAME" < "$SCRIPT_DIR/kurastream_data.sql"
fi
# Aplica (o completa, tras importar un volcado antiguo) las migraciones de php_backend/migrations.
echo "  -> Aplicando migraciones de esquema pendientes..."
(cd "$SCRIPT_DIR" && php -r 'require "php_backend/db.php"; $r = Database::initializeSchema(); echo json_encode($r), PHP_EOL;')

# 4. Servicio Systemd para arranque automático al encender el equipo
echo "[4/5] Configurando servicio systemd para que KuraStream arranque solo al encender..."
SERVICE_FILE="/etc/systemd/system/kurastream.service"
CURRENT_USER=$(whoami)

# PHP_CLI_SERVER_WORKERS: sin él, el servidor integrado atiende una sola petición a la vez y un
# video en reproducción o un Watch Party (SSE) bloquea al resto de dispositivos.
sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=KuraStream Media Server
After=network.target mariadb.service
Requires=mariadb.service

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
Environment=PHP_CLI_SERVER_WORKERS=$SERVER_WORKERS
ExecStart=/usr/bin/php -d upload_max_filesize=4096M -d post_max_size=4096M -d memory_limit=512M -d max_execution_time=600 -d max_input_time=600 -S 0.0.0.0:3000 $SCRIPT_DIR/php_backend/router.php
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable kurastream
sudo systemctl restart kurastream

# 5. Configurar Hotspot Wi-Fi permanente en NetworkManager
echo "[5/5] Configurando Zona Wi-Fi (Hotspot) automática..."
WIFI_IFACE=$(nmcli device status | awk '$2=="wifi" {print $1; exit}')

if [ -n "$WIFI_IFACE" ]; then
    echo "  -> Interfaz Wi-Fi encontrada: $WIFI_IFACE"
    sudo nmcli connection delete "KuraStream-Hotspot" 2>/dev/null || true
    sudo nmcli connection add type wifi ifname "$WIFI_IFACE" con-name "KuraStream-Hotspot" autoconnect yes ssid "$HOTSPOT_SSID"
    sudo nmcli connection modify "KuraStream-Hotspot" 802-11-wireless.mode ap 802-11-wireless.band bg
    sudo nmcli connection modify "KuraStream-Hotspot" 802-11-wireless-security.key-mgmt wpa-psk 802-11-wireless-security.psk "$HOTSPOT_PASSWORD"
    sudo nmcli connection modify "KuraStream-Hotspot" ipv4.method shared connection.autoconnect-priority 100
    sudo nmcli connection up "KuraStream-Hotspot" || true
    echo ""
    echo "=========================================================="
    echo "  ¡INSTALACIÓN COMPLETADA CON ÉXITO!"
    echo "=========================================================="
    echo "  Red Wi-Fi generada por la laptop: $HOTSPOT_SSID"
    echo "  Contraseña de la Wi-Fi:           $HOTSPOT_PASSWORD"
    echo "  Dirección web en el celular/PC:   http://10.42.0.1:3000"
    echo "=========================================================="
else
    echo "  [AVISO] No se detectó interfaz Wi-Fi automáticamente."
    echo "  Puedes activar el hotspot con: nmcli device wifi hotspot ifname <tu_wifi> ssid $HOTSPOT_SSID password <clave>"
fi
