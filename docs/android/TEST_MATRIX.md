# KuraStream Android Test Matrix & Verification Record

Este documento registra la matriz de compatibilidad, resultados de pruebas unitarias, verificación de contratos y análisis de rendimiento para el cliente nativo de **KuraStream**.

---

## 1. Matriz de Versiones de Android

| Nivel de API | Versión de Android | Estado | Funcionalidades Específicas Evaluadas |
|---|---|---|---|
| **API 26** | Android 8.0 Oreo (minSdk) | **Soportado** | Compatibilidad sin `NoSuchMethodError`, cifrado Keystore AES-256-GCM, notification channels, vector drawables y SurfaceView nativo. |
| **API 28** | Android 9.0 Pie | **Soportado** | Configuración de red para tráfico cleartext HTTP local (`network_security_config.xml`) con advertencia de conexión no cifrada. |
| **API 33** | Android 13 | **Soportado** | Solicitud contextual de permisos `POST_NOTIFICATIONS` y selector de idioma por aplicación. |
| **API 34** | Android 14 | **Soportado** | Declaración estricta de `foregroundServiceType="mediaPlayback"` para el servicio de MediaSession. |
| **API 37** | Android 17 (compileSdk / targetSdk) | **Soportado** | Declaración contextual del permiso `ACCESS_LOCAL_NETWORK` para acceso a servidores en la subred local (LAN) y Edge-to-Edge nativo. |

---

## 2. Resumen de Pruebas Ejecutadas

### A. Pruebas Unitarias de Android (`./gradlew testDebugUnitTest`)
- **Total ejecutadas**: 38 pruebas.
- **Resultados**: **38 pasadas, 0 falladas, 0 ignoradas**.
- **Cobertura**:
  1. `ServerUrlResolverTest`: Normalización de dominios HTTPS, puertos personalizados, rangos de IP privadas (10.x, 192.168.x, 172.16-31.x, 127.x, .local), rechazo de esquemas no permitidos (`ftp://`, `file://`), y construcción de URLs de streaming.
  2. `StreamResolverTest`: Reglas de Direct Play (MP4/H.264) vs Remux (MKV / pistas de audio secundarias), cálculo de tiempo absoluto (`streamStartOffsetSeconds`), normalización de idiomas (spa, es, es-419, lat, jpn, ja, eng), avance automático entre temporadas (S1E12 -> S2E1), y umbral de completado al 90%.
  3. `WatchPartySyncTest`: Detección de drift, corrección de reloj de sala y umbral de re-sincronización de ExoPlayer.
  4. `ProfileIsolationTest`: Aislamiento de caché en base de datos local mediante clave compuesta `(serverId, profileId)` y reemplazo atómico de JWT en `SecureTokenStorage`.
  5. `DeepLinkParserTest`: Parsing de URLs `kurastream://server`, `kurastream://show`, `kurastream://episode` y `kurastream://party`.
  6. `UiStateTest`: Verificación de transiciones de estado inmutable (Loading, Success, Error, Empty).

### B. Análisis Estático (`./gradlew lintDebug`)
- **Resultado**: **BUILD SUCCESSFUL**. Cero errores bloqueantes de lint.

### C. Compilación de Artefacto (`./gradlew assembleDebug`)
- **Resultado**: **BUILD SUCCESSFUL**.
- **Archivo generado**: `android/app/build/outputs/apk/debug/app-debug.apk` (23,565,505 bytes).

### D. Verificación de Contratos con el Backend (`node scripts/test_android_contracts.mjs`)
- **Resultado**: **7/7 pasadas**.
- Cobertura de endpoints REST, SSE de Watch Party, Version Catalog, permisos de Android 17 y paridad de tokens de color con `frontend/css/tokens.css`.

### E. Suite de Regresión del Backend PHP (`npm test`)
- **Resultado**: **41/41 pasadas, 0 falladas**. Cero regresiones en la plataforma existente.

---

## 3. Dispositivos de Bajos Recursos (Perfil de 2GB RAM)

- **Optimización de Memoria**:
  - `Coil` configurado con escalado automático al tamaño de la vista (`crossfade` y descarte rápido de bitmaps en cache LRU).
  - Componentes `LazyRow` y `LazyColumn` utilizan `key = { item.id }` para evitar recomposiciones innecesarias durante el scroll.
  - El estado del reproductor desacopla las actualizaciones de alta frecuencia (segundos del timeline) de los contenedores pesados de Compose mediante estados locales.
  - SurfaceView preferido sobre TextureView para reducir la sobrecarga de composición gráfica de la GPU.
