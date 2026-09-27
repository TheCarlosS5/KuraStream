#!/usr/bin/env bash
# ==============================================================================
# KuraStream - Script de Configuración Todo-en-Uno para Debian (Sin Docker)
# Configura: Dependencias, MariaDB, Servicio de arranque automático y Hotspot Wi-Fi
# ==============================================================================
set -e

echo "=========================================================="
echo "  Iniciando instalación y configuración de KuraStream"
echo "=========================================================="

# 1. Dependencias del sistema
echo "[1/4] Instalando paquetes requeridos (PHP, MariaDB, FFmpeg, NetworkManager)..."
sudo apt-get update
sudo apt-get install -y php-cli php-mysql php-curl php-mbstring php-xml mariadb-server ffmpeg network-manager

# 2. Configurar MariaDB
echo "[2/4] Configurando base de datos local MariaDB..."
sudo systemctl enable --now mariadb
sudo mariadb -e "CREATE DATABASE IF NOT EXISTS kurastream CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mariadb -e "CREATE USER IF NOT EXISTS 'kurastream'@'localhost' IDENTIFIED BY 'kurastream_db_pass_2026';"
sudo mariadb -e "GRANT ALL PRIVILEGES ON kurastream.* TO 'kurastream'@'localhost';"
sudo mariadb -e "FLUSH PRIVILEGES;"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -f "$SCRIPT_DIR/kurastream_data.sql" ]; then
    echo "  -> Importando catálogo y datos existentes desde kurastream_data.sql..."
    sudo mariadb kurastream < "$SCRIPT_DIR/kurastream_data.sql"
else
    echo "  -> Aplicando migraciones de esquema iniciales..."
    for f in "$SCRIPT_DIR"/database/migrations/*.sql; do
        sudo mariadb kurastream < "$f"
    done
fi

# 3. Servicio Systemd para arranque automático al encender el equipo
echo "[3/4] Configurando servicio systemd para que KuraStream arranque solo al encender..."
SERVICE_FILE="/etc/systemd/system/kurastream.service"
CURRENT_USER=$(whoami)

sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=KuraStream Media Server
After=network.target mariadb.service
Requires=mariadb.service

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/php -S 0.0.0.0:3000 $SCRIPT_DIR/php_backend/router.php
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now kurastream

# 4. Configurar Hotspot Wi-Fi permanente en NetworkManager
echo "[4/4] Configurando Zona Wi-Fi (Hotspot) automática..."
WIFI_IFACE=$(nmcli device status | awk '$2=="wifi" {print $1; exit}')

if [ -n "$WIFI_IFACE" ]; then
    echo "  -> Interfaz Wi-Fi encontrada: $WIFI_IFACE"
    sudo nmcli connection delete "KuraStream-Hotspot" 2>/dev/null || true
    sudo nmcli connection add type wifi ifname "$WIFI_IFACE" con-name "KuraStream-Hotspot" autoconnect yes ssid "KuraStream-WiFi"
    sudo nmcli connection modify "KuraStream-Hotspot" 802-11-wireless.mode ap 802-11-wireless.band bg
    sudo nmcli connection modify "KuraStream-Hotspot" 802-11-wireless-security.key-mgmt wpa-psk 802-11-wireless-security.psk "kurastream2026"
    sudo nmcli connection modify "KuraStream-Hotspot" ipv4.method shared connection.autoconnect-priority 100
    sudo nmcli connection up "KuraStream-Hotspot" || true
    echo ""
    echo "=========================================================="
    echo "  ¡INSTALACIÓN COMPLETADA CON ÉXITO!"
    echo "=========================================================="
    echo "  Red Wi-Fi generada por la laptop: KuraStream-WiFi"
    echo "  Contraseña de la Wi-Fi:           kurastream2026"
    echo "  Dirección web en el celular/PC:   http://10.42.0.1:3000"
    echo "=========================================================="
else
    echo "  [AVISO] No se detectó interfaz Wi-Fi automáticamente."
    echo "  Puedes activar el hotspot con: nmcli device wifi hotspot ifname <tu_wifi> ssid KuraStream-WiFi password kurastream2026"
fi
