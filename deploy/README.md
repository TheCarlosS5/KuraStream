# Despliegue de KuraStream

Hay tres formas de ejecutar KuraStream. Para uso real con varias personas a la vez usa **nginx + PHP-FPM**
(Docker o Debian). `php -S` es solo para desarrollo.

| Modo | Para qué | Cómo |
|---|---|---|
| Docker Compose | servidor en cualquier Linux con Docker | `docker compose up -d --build` |
| Debian/Ubuntu | portátil o mini-PC dedicado | `scripts/debian_setup.sh` |
| `php -S` | desarrollo (Windows, macOS, Linux) | `npm run dev` |

## Qué corre en producción

```
 móviles / PC ──► nginx :3000 ──┬─ archivos de la web, imágenes ................ (nginx directamente)
                                ├─ /api/*            ──► pool PHP-FPM "api"     (peticiones cortas, 32 procesos)
                                ├─ /api/party/stream ──► pool PHP-FPM "stream"  (SSE de Watch Party)
                                ├─ /api/stream/*     ──► pool PHP-FPM "stream"  (autoriza; nginx envía los bytes)
                                └─ /api/admin/*      ──► pool PHP-FPM "stream"  (subidas de hasta 4 GB, escaneos)
 kurastream-worker ──► escaneos, respaldos diarios, subtítulos/fuentes, limpieza   (php_backend/worker.php)
```

* **Reproducción directa sin ocupar PHP.** PHP solo comprueba la sesión y responde `X-Accel-Redirect`; nginx envía el
  archivo con `sendfile` y gestiona los rangos. Se desactiva con `X_ACCEL=0` (se activa solo si PHP corre bajo nginx).
* **`?direct=1`** pide el archivo tal cual (cualquier contenedor: MKV, etc.) para reproductores nativos como ExoPlayer.
* **Dirección real de los clientes.** nginx habla con PHP-FPM por FastCGI, así que PHP ve la IP real
  (`REMOTE_ADDR`) y el límite de peticiones funciona por persona. No hace falta `TRUSTED_PROXIES`; solo si pones otro
  proxy HTTP delante de nginx.
* **Worker.** Mientras corre, los escaneos y sincronizaciones desde el panel de admin se ponen en cola y el panel
  sigue su progreso. Sin worker (p. ej. `php -S`) se ejecutan dentro de la petición, como antes.
  `JOBS_MODE=auto|queue|inline` lo fuerza.
* **Respaldos.** El worker hace un `mysqldump` comprimido al día (`BACKUP_DIR`, se guardan `BACKUP_KEEP`=7).
  Desde el panel de admin: `GET/POST /api/admin/backups`.

## Docker

```bash
cp .env.example .env        # JWT_SECRET, DB_PASS, MYSQL_ROOT_PASSWORD, ADMIN_USER y ADMIN_PASS/ADMIN_PASS_HASH
echo "KURA_UID=$(id -u)" >> .env && echo "KURA_GID=$(id -g)" >> .env   # mismo dueño que ./library
docker compose up -d --build
```

Servicios: `nginx` (puerto `PORT`, 3000 por defecto), `app` (PHP-FPM), `worker`, `mysql`.
La biblioteca (`./library`) y la misma ruta dentro de los contenedores es lo que nginx usa para `/_media/`.

## Debian / Ubuntu

```bash
sudo -v && scripts/debian_setup.sh
```

Instala nginx, PHP-FPM, MariaDB y FFmpeg, crea el usuario de sistema `kurastream`, escribe `.env` con secretos
aleatorios (la contraseña del administrador queda ahí; no se imprime), configura los pools, el worker
(`kurastream-worker.service`) y, si hay Wi-Fi, un hotspot con clave aleatoria (en 5 GHz si la tarjeta lo soporta).
Se puede volver a ejecutar para actualizar. Ver el estado: `systemctl status nginx php*-fpm kurastream-worker`.

## Archivos

| Archivo | Para qué |
|---|---|
| `deploy/nginx/kurastream.conf.template` | configuración de nginx (la usan Docker y Debian) |
| `deploy/nginx/security-headers.conf` | cabeceras de seguridad; se genera desde `config.php` (`php php_backend/scripts/print_security_headers.php > deploy/nginx/security-headers.conf`) y una prueba falla si se desincroniza |
| `deploy/php-fpm/*.template` | los dos pools de PHP-FPM |
| `deploy/systemd/kurastream-worker.service.template` | servicio del worker |
| `scripts/render_deploy.sh` | rellena las plantillas (`KURA_*`) |
| `Dockerfile`, `docker/` | imagen de la aplicación (PHP-FPM) y de nginx |

## HTTPS en la red local (opcional)

Sin HTTPS, en `http://IP:3000` el navegador no activa el service worker, ni la instalación de la PWA, ni el
portapapeles. La app de Android no lo necesita. Si lo quieres:

1. Consigue un certificado para un nombre que apunte a la IP local (por ejemplo un subdominio de DuckDNS con
   certificado Let's Encrypt por DNS-01, p. ej. con `acme.sh`), o uno propio de una CA local (`mkcert`).
2. Crea `/etc/nginx/kurastream.d/tls.conf` (en Docker, móntalo en esa ruta dentro del contenedor nginx):

   ```nginx
   listen 443 ssl;
   ssl_certificate     /etc/ssl/kurastream/fullchain.pem;
   ssl_certificate_key /etc/ssl/kurastream/privkey.pem;
   ssl_protocols TLSv1.2 TLSv1.3;
   add_header Strict-Transport-Security "max-age=31536000" always;
   ```
3. `nginx -t && systemctl reload nginx`. Algunos routers bloquean respuestas DNS con IP privada
   («DNS rebinding»); si el nombre no resuelve, añade una excepción o usa el archivo `hosts`/DNS local del router.
