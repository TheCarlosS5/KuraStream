# Pruebas de carga

`k6_30_users.js` simula 30 personas a la vez en la LAN: inicio de sesión, catálogo, reproducción directa por rangos,
10 salas de Watch Party (SSE) y 4 remux. Úsalo **antes y después** de cambiar la infraestructura para comparar.

```bash
k6 run -e BASE_URL=http://192.168.1.50:3000 -e USERS=30 -e DURATION=3m tests/load/k6_30_users.js
```

Objetivos (umbrales del script): ninguna petición de API por encima de 1 s (p95), catálogo p95 < 300 ms, menos de
2 % de errores. Mientras corre, comprueba en el servidor: `ps aux | grep -c "[f]fmpeg"` (solo los remux pedidos) y
`systemctl status php*-fpm` (procesos ocupados).

`php_load_smoke.php` es una versión sin k6 (solo PHP) para comprobar rápido, p. ej. en CI, que el catálogo responde
bien con concurrencia.

## Límites de peticiones durante la prueba

El servidor limita por dirección (10 inicios de sesión cada 5 minutos, registros por hora, etc.). Una prueba desde un
solo equipo los supera enseguida: arranca el servidor bajo prueba con `RATE_LIMIT_MULTIPLIER=1000` y
`REGISTER_MAX_PER_HOUR=1000`. (`RATE_LIMIT_MULTIPLIER` también sirve en una red donde muchos dispositivos comparten
una misma dirección.) Los límites por cuenta, como los intentos de PIN, no se escalan.
