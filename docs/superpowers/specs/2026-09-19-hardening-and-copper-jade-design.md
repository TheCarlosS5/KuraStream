# KuraStream: seguridad, fiabilidad y diseño cobre-jade

## Objetivo

Eliminar riesgos de pérdida de biblioteca e inyección de contenido, hacer fiable Watch Party y los metadatos de vídeo, y sustituir el tema morado por un sistema visual oscuro de cobre y jade sin cambiar los flujos principales de reproducción.

## Decisiones de producto

- La eliminación de un anime solo puede eliminar su carpeta canónica: `<biblioteca>/<Anime|Movies>/<id-del-show>`. Nunca se inferirá una carpeta a partir de una coincidencia parcial de título.
- Los textos y atributos procedentes de la API se tratarán como datos, no como HTML. Las rutas de reproducción se crearán mediante valores codificados, no mediante atributos `onclick` interpolados.
- Watch Party mantendrá su modo de invitado, pero cada entrada tendrá un identificador temporal firmado por el servidor. La misma persona no aumentará el contador al recargar y no podrá disminuir el contador de otra.
- Las conexiones SSE tendrán un límite por IP/sala y una cadencia de consulta más conservadora. El canal seguirá siendo público para las salas públicas.
- La interfaz será oscura y cálida: fondo `#090D0E`, superficies `#131A1C`, acción cobre `#F97316`, hover `#FB923C`, éxito jade `#2DD4BF`, rating `#FBBF24`, texto `#F4F8F9` y texto secundario `#93A4A7`.

## Compatibilidad y límites

- No se eliminarán ni moverán vídeos existentes fuera de una acción explícita de borrado del administrador.
- Se conservarán los endpoints actuales de catálogo, reproducción y Watch Party.
- Las pruebas que requieren MySQL deben poder arrancar con el servicio definido en `docker-compose.yml`; las pruebas puramente unitarias no deben exigir una base de datos disponible.
- No se añadirá alojamiento externo, telemetría ni dependencias de pago.

## Criterios de aceptación

1. Borrar un show no puede eliminar una carpeta de otro show con un título parecido.
2. Un título, sinopsis, género o episodio con HTML se representa como texto inofensivo.
3. El FPS devuelto por el escáner coincide con el valor detectado por ffprobe.
4. El contador de Watch Party no cambia al volver a entrar con la misma sesión y una salida solo afecta a esa sesión.
5. El CSS no conserva variables moradas de marca ni estilos morados embebidos para acciones principales.
6. Las pruebas documentan cómo iniciar MySQL y distinguen una dependencia de infraestructura de un fallo de aplicación.
