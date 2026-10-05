#!/usr/bin/env bash
# ==============================================================================
# KuraStream - instalación todo-en-uno para Debian/Ubuntu (sin Docker)
#
# Instala y configura: nginx + PHP-FPM (dos pools), MariaDB, FFmpeg, el worker en segundo plano
# (kurastream-worker.service), un usuario de sistema dedicado y, opcionalmente, un hotspot Wi-Fi.
#
# Variables opcionales:
#   SERVER_PORT       puerto de la web (por defecto 3000)
#   LIBRARY_PATH      carpeta de la biblioteca (por defecto <proyecto>/library, o MEDIA_LIBRARY_PATH del .env)
#   HOTSPOT_SSID      nombre de la red Wi-Fi (por defecto KuraStream-WiFi)
#   HOTSPOT_PASSWORD  clave del hotspot (mínimo 8). Si no se da, se genera una al azar
#   HOTSPOT_BAND      "a" (5 GHz) o "bg" (2.4 GHz). Por defecto: 5 GHz si la tarjeta lo soporta
#   SKIP_HOTSPOT=1    no tocar la configuración Wi-Fi
#
# Se puede ejecutar de nuevo sin problema para actualizar la configuración.
# ==============================================================================
set -euo pipefail

SERVER_PORT="${SERVER_PORT:-3000}"
HOTSPOT_SSID="${HOTSPOT_SSID:-KuraStream-WiFi}"
SERVICE_USER="kurastream"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

echo "=========================================================="
echo "  Instalación y configuración de KuraStream"
echo "=========================================================="

# 1. Dependencias del sistema
echo "[1/7] Instalando paquetes (nginx, PHP-FPM, MariaDB, FFmpeg, NetworkManager)..."
sudo apt-get update
sudo apt-get install -y nginx php-fpm php-cli php-mysql php-curl php-mbstring php-xml mariadb-server mariadb-client \
    ffmpeg network-manager openssl perl acl

PHP_VERSION="$(php -r 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;')"
PHP_BIN="$(command -v php)"
FPM_DIR="/etc/php/$PHP_VERSION/fpm"
FPM_SERVICE="php$PHP_VERSION-fpm"
if [ ! -d "$FPM_DIR/pool.d" ]; then
    echo "  [ERROR] No se encontró $FPM_DIR/pool.d (paquete php-fpm de PHP $PHP_VERSION)." >&2
    exit 1
fi

# 2. Usuario de servicio: la aplicación no corre con tu usuario ni como root
echo "[2/7] Usuario de servicio '$SERVICE_USER'..."
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    sudo useradd --system --home-dir "$SCRIPT_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
# nginx (www-data) lee la web y los videos con el grupo del servicio
sudo usermod -a -G "$SERVICE_USER" www-data

# 3. Archivo .env (config.php lo lee; sin él el servidor no arranca)
echo "[3/7] Preparando configuración (.env)..."
env_value() {
    grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2-
}
ensure_env() {   # ensure_env KEY VALUE : añade la clave solo si falta
    if ! grep -qE "^$1=" "$ENV_FILE"; then
        echo "$1=$2" >> "$ENV_FILE"
    fi
}
if [ ! -f "$ENV_FILE" ]; then
    DB_PASSWORD="$(openssl rand -hex 16)"
    ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
    umask 077
    cat > "$ENV_FILE" <<EOT
PORT=$SERVER_PORT
JWT_SECRET=$(openssl rand -hex 32)
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=kurastream
DB_USER=kurastream
DB_PASS=$DB_PASSWORD
ADMIN_USER=admin
ADMIN_PASS=$ADMIN_PASSWORD
MEDIA_LIBRARY_PATH=${LIBRARY_PATH:-$SCRIPT_DIR/library}
TMDB_API_KEY=
TMDB_READ_TOKEN=
APP_TIMEZONE=America/Bogota
EOT
    umask 022
    echo "  -> .env creado. El usuario y la contraseña del administrador están en $ENV_FILE (ADMIN_USER / ADMIN_PASS)."
else
    echo "  -> Usando el .env existente."
fi
[ -n "${LIBRARY_PATH:-}" ] && ! grep -qE '^MEDIA_LIBRARY_PATH=' "$ENV_FILE" && echo "MEDIA_LIBRARY_PATH=$LIBRARY_PATH" >> "$ENV_FILE"
ensure_env SUBTITLE_CACHE_DIR /var/cache/kurastream/subtitles
ensure_env BACKUP_DIR /var/backups/kurastream
ensure_env JOBS_MODE auto
# El servicio lee el .env; nadie más.
sudo chown "root:$SERVICE_USER" "$ENV_FILE"
sudo chmod 640 "$ENV_FILE"

DB_NAME="$(env_value DB_NAME)"; DB_NAME="${DB_NAME:-kurastream}"
DB_USER="$(env_value DB_USER)"; DB_USER="${DB_USER:-kurastream}"
DB_PASSWORD="$(env_value DB_PASS)"
if [ -z "$DB_PASSWORD" ]; then
    echo "  [ERROR] DB_PASS está vacío en $ENV_FILE" >&2
    exit 1
fi
LIBRARY_DIR="$(env_value MEDIA_LIBRARY_PATH)"; LIBRARY_DIR="${LIBRARY_DIR:-$SCRIPT_DIR/library}"
case "$LIBRARY_DIR" in /*) ;; *) LIBRARY_DIR="$SCRIPT_DIR/${LIBRARY_DIR#./}" ;; esac

# Carpetas de trabajo con sus permisos
sudo mkdir -p "$LIBRARY_DIR" /var/cache/kurastream/subtitles /var/backups/kurastream
sudo chown -R "$SERVICE_USER:$SERVICE_USER" /var/cache/kurastream /var/backups/kurastream
sudo chmod 750 /var/backups/kurastream
# La biblioteca es de lectura/escritura para el servicio (importaciones, carátulas) y de lectura para nginx (grupo).
sudo chown "$SERVICE_USER:$SERVICE_USER" "$LIBRARY_DIR"
sudo chmod 2775 "$LIBRARY_DIR"
sudo find "$LIBRARY_DIR" -maxdepth 1 -mindepth 1 -exec chown -R "$SERVICE_USER:$SERVICE_USER" {} + 2>/dev/null || true
sudo find "$LIBRARY_DIR" -type d -exec chmod g+rx,o+rx {} + 2>/dev/null || true

# El servicio y nginx deben poder atravesar las carpetas que llevan al proyecto (p. ej. /home/usuario, que en
# Debian suele ser 700). Solo se añade el permiso de "entrar" (x) para otros, no el de listar.
dir="$SCRIPT_DIR"
while [ "$dir" != "/" ]; do
    if ! sudo -u "$SERVICE_USER" test -x "$dir" 2>/dev/null; then
        echo "  -> Permitiendo atravesar $dir (chmod o+x)"
        sudo chmod o+x "$dir"
    fi
    dir="$(dirname "$dir")"
done
sudo -u "$SERVICE_USER" test -r "$SCRIPT_DIR/php_backend/router.php" || { echo "  [ERROR] $SERVICE_USER no puede leer $SCRIPT_DIR" >&2; exit 1; }

# 4. MariaDB
echo "[4/7] Configurando MariaDB..."
sudo systemctl enable --now mariadb
sudo mariadb <<EOT
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
EOT

if [ -f "$SCRIPT_DIR/kurastream_data.sql" ]; then
    echo "  -> Importando catálogo y datos existentes desde kurastream_data.sql..."
    sudo mariadb "$DB_NAME" < "$SCRIPT_DIR/kurastream_data.sql"
fi
# Aplica (o completa, tras importar un volcado antiguo) las migraciones de php_backend/migrations.
echo "  -> Aplicando migraciones de esquema pendientes..."
sudo -u "$SERVICE_USER" bash -c "cd '$SCRIPT_DIR' && '$PHP_BIN' -r 'require \"php_backend/db.php\"; \$r = Database::initializeSchema(); echo json_encode(\$r), PHP_EOL;'"

# 5. nginx + PHP-FPM (dos pools: "api" para peticiones cortas y "stream" para video, Watch Party y subidas)
echo "[5/7] Configurando nginx y PHP-FPM..."
export KURA_USER="$SERVICE_USER" KURA_GROUP="$SERVICE_USER" KURA_WEB_USER=www-data KURA_WEB_GROUP=www-data
export KURA_API_LISTEN=/run/php/kurastream-api.sock KURA_STREAM_LISTEN=/run/php/kurastream-stream.sock
export KURA_PHP_ERROR_LOG=/var/log/kurastream-php-error.log
export KURA_PORT="$SERVER_PORT" KURA_APP_DIR="$SCRIPT_DIR" KURA_LIBRARY_DIR="$LIBRARY_DIR"
export KURA_API_UPSTREAM="unix:$KURA_API_LISTEN" KURA_STREAM_UPSTREAM="unix:$KURA_STREAM_LISTEN"
export KURA_PHP_BIN="$PHP_BIN"

sudo touch "$KURA_PHP_ERROR_LOG"
sudo chown "$SERVICE_USER:adm" "$KURA_PHP_ERROR_LOG"
sudo chmod 640 "$KURA_PHP_ERROR_LOG"
# El pool "www" por defecto sobra
[ -f "$FPM_DIR/pool.d/www.conf" ] && sudo mv "$FPM_DIR/pool.d/www.conf" "$FPM_DIR/pool.d/www.conf.disabled"
"$SCRIPT_DIR/scripts/render_deploy.sh" "$SCRIPT_DIR/deploy/php-fpm/kurastream-api.conf.template" | sudo tee "$FPM_DIR/pool.d/kurastream-api.conf" >/dev/null
"$SCRIPT_DIR/scripts/render_deploy.sh" "$SCRIPT_DIR/deploy/php-fpm/kurastream-stream.conf.template" | sudo tee "$FPM_DIR/pool.d/kurastream-stream.conf" >/dev/null
# La aplicación lee el .env ella misma; FPM solo necesita no limpiar el entorno (ya está en las plantillas).
sudo "php-fpm$PHP_VERSION" -t
sudo systemctl enable "$FPM_SERVICE"
sudo systemctl restart "$FPM_SERVICE"

sudo mkdir -p /etc/nginx/kurastream.d
"$SCRIPT_DIR/scripts/render_deploy.sh" "$SCRIPT_DIR/deploy/nginx/kurastream.conf.template" | sudo tee /etc/nginx/conf.d/kurastream.conf >/dev/null
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

# 6. Worker en segundo plano (escaneos, respaldos diarios, subtítulos, limpieza) y adiós al servicio antiguo (php -S)
echo "[6/7] Configurando el worker (kurastream-worker.service)..."
if systemctl list-unit-files kurastream.service >/dev/null 2>&1 && [ -f /etc/systemd/system/kurastream.service ]; then
    sudo systemctl disable --now kurastream.service || true
    sudo rm -f /etc/systemd/system/kurastream.service
fi
"$SCRIPT_DIR/scripts/render_deploy.sh" "$SCRIPT_DIR/deploy/systemd/kurastream-worker.service.template" | sudo tee /etc/systemd/system/kurastream-worker.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable kurastream-worker
sudo systemctl restart kurastream-worker

# 7. Hotspot Wi-Fi (opcional)
echo "[7/7] Zona Wi-Fi (Hotspot)..."
HOTSPOT_NOTE="no configurado"
if [ "${SKIP_HOTSPOT:-0}" != "1" ]; then
    WIFI_IFACE="$(nmcli device status | awk '$2=="wifi" {print $1; exit}')"
    if [ -n "$WIFI_IFACE" ]; then
        echo "  -> Interfaz Wi-Fi encontrada: $WIFI_IFACE"
        # Clave: la que se indique, la que ya tenía el hotspot, o una nueva al azar.
        if [ -z "${HOTSPOT_PASSWORD:-}" ]; then
            HOTSPOT_PASSWORD="$(sudo nmcli -s -g 802-11-wireless-security.psk connection show KuraStream-Hotspot 2>/dev/null || true)"
        fi
        if [ -z "${HOTSPOT_PASSWORD:-}" ]; then
            HOTSPOT_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-12)"
        fi
        if [ "${#HOTSPOT_PASSWORD}" -lt 8 ]; then
            echo "  [ERROR] HOTSPOT_PASSWORD debe tener al menos 8 caracteres" >&2
            exit 1
        fi
        # 5 GHz es mucho más rápido y menos saturado que 2.4 GHz; solo si la tarjeta lo soporta.
        if [ -z "${HOTSPOT_BAND:-}" ]; then
            if nmcli -f WIFI-PROPERTIES device show "$WIFI_IFACE" 2>/dev/null | grep -qE '5GHZ:\s+(yes|sí|si)'; then
                HOTSPOT_BAND=a
            else
                HOTSPOT_BAND=bg
            fi
        fi
        sudo nmcli connection delete "KuraStream-Hotspot" 2>/dev/null || true
        sudo nmcli connection add type wifi ifname "$WIFI_IFACE" con-name "KuraStream-Hotspot" autoconnect yes ssid "$HOTSPOT_SSID"
        sudo nmcli connection modify "KuraStream-Hotspot" 802-11-wireless.mode ap 802-11-wireless.band "$HOTSPOT_BAND"
        sudo nmcli connection modify "KuraStream-Hotspot" 802-11-wireless-security.key-mgmt wpa-psk 802-11-wireless-security.psk "$HOTSPOT_PASSWORD"
        sudo nmcli connection modify "KuraStream-Hotspot" ipv4.method shared connection.autoconnect-priority 100
        sudo nmcli connection up "KuraStream-Hotspot" || true
        HOTSPOT_NOTE="red $HOTSPOT_SSID  ·  clave $HOTSPOT_PASSWORD  ·  banda $HOTSPOT_BAND"
    else
        echo "  [AVISO] No se detectó interfaz Wi-Fi. Puedes activar un hotspot con:"
        echo "          nmcli device wifi hotspot ifname <tu_wifi> ssid $HOTSPOT_SSID password <clave>"
    fi
fi

echo ""
echo "=========================================================="
echo "  ¡INSTALACIÓN COMPLETADA!"
echo "=========================================================="
echo "  Web:              http://10.42.0.1:$SERVER_PORT  (hotspot)  o  http://<IP-de-esta-máquina>:$SERVER_PORT"
echo "  Hotspot Wi-Fi:    $HOTSPOT_NOTE"
echo "  Administrador:    usuario y contraseña en $ENV_FILE (ADMIN_USER / ADMIN_PASS)"
echo "  Biblioteca:       $LIBRARY_DIR"
echo "  Respaldos diarios: /var/backups/kurastream (los hace el worker)"
echo "  Servicios:        nginx, $FPM_SERVICE, kurastream-worker, mariadb"
echo "  Estado:           systemctl status nginx $FPM_SERVICE kurastream-worker"
echo "  Para mejor rendimiento con muchos usuarios usa un router Wi-Fi dedicado conectado por cable."
echo "=========================================================="
