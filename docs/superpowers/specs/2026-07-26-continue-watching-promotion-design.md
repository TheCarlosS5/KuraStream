# Especificación de Diseño: Promoción Automática de Siguiente Capítulo en "Seguir Viendo"

**Fecha**: 2026-07-26  
**Estado**: Aprobado por el usuario  
**Autor**: Antigravity

---

## 1. Contexto y Objetivos

KuraStream cuenta con una fila de "Seguir Viendo" en la página principal que muestra los episodios que el usuario ha reproducido recientemente. Actualmente, si el usuario completa un episodio (llega al 100%), este se muestra permanentemente como "100% visto" en lugar de actualizarse al siguiente capítulo.

El objetivo de este diseño es promover automáticamente el **siguiente capítulo** de una serie con 0% de progreso una vez que el actual se marque como "completado" (reproducido al 95% o más de su duración).

## 2. Cambios en el Backend (Base de Datos)

Modificaremos la función `getHistory(username)` en `backend/db.js` para realizar el procesamiento post-consulta.

### Lógica Detallada:
Para cada registro en el historial de reproducción de un show:
1. Si `rec.duration` es mayor a 0 y `rec.progress_seconds >= 0.95 * rec.duration`:
   * Buscar el siguiente episodio de la serie usando:
     ```sql
     SELECT e.id, e.title, e.episode_number, e.season_number, e.thumbnail_path, e.duration
     FROM episodes e
     WHERE e.show_id = ? AND (e.season_number > ? OR (e.season_number = ? AND e.episode_number > ?))
     ORDER BY e.season_number ASC, e.episode_number ASC
     LIMIT 1
     ```
   * Si existe, reemplazar el registro del historial con el del siguiente capítulo (`progress_seconds: 0`).
   * Si no existe (fin de la serie), omitir esta serie del listado.
2. Si el progreso es inferior al 95%, mantener el registro si y solo si `progress_seconds > 0`.

## 3. Cambios en el Frontend

Ninguno necesario. El frontend lee directamente los datos del endpoint `/api/history` y dibuja las tarjetas horizontales. Al recibir el nuevo capítulo con progreso 0, lo mostrará automáticamente como un elemento más de la lista con la barra de progreso vacía (0% visto) y con un enlace que inicia su reproducción desde el segundo 0.

---
*(Fin del documento)*
