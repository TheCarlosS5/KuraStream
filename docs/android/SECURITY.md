# KuraStream Android Security & Privacy Architecture

Este documento detalla las medidas de seguridad, protección de secretos y aislamiento de perfiles implementadas en el cliente nativo de **KuraStream**.

---

## 1. Almacenamiento Seguro de Credenciales (Android Keystore + AES-256-GCM)

A diferencia de implementaciones inseguras que almacenan tokens JWT en texto plano en `SharedPreferences` o bases de datos SQLite locales:
- **`SecureTokenStorage`** utiliza el proveedor criptográfico del hardware del dispositivo (`AndroidKeyStore`).
- Genera una clave maestra `AES/GCM/NoPadding` de 256 bits (`KeyProperties.KEY_ALGORITHM_AES`).
- Cada token se cifra con un vector de inicialización (`IV`) único de 12 bytes generado aleatoriamente.
- El IV y el texto cifrado se almacenan en un archivo privado de preferencias (`kura_secure_store`).
- Es 100% compatible con **Android 8.0 (API 26)** y versiones superiores.

---

## 2. Reemplazo Atómico del Token de Perfil

En KuraStream, el token entregado al iniciar sesión (`/api/login`) pertenece a la cuenta de usuario general. Cuando el usuario selecciona un perfil específico (`/api/profiles/select` con o sin PIN), el backend emite un nuevo JWT enriquecido con los claims del perfil:
- `profile_id`
- `profile_name`
- `is_kids`

El cliente Android implementa un método atómico `setProfileToken(token, profileId, username)` en `SecureTokenStorage` que sobrescribe inmediatamente el token anterior. Nunca se conservan tokens antiguos en memoria o almacenamiento secundario.

---

## 3. Aislamiento Estricto de Caché por Servidor y Perfil

Para evitar fugas de información o visualización de contenido entre perfiles:
1. **Base de Datos Local (Room)**:
   Las entidades `ShowEntity`, `HistoryEntity` y `FavoritesEntity` tienen claves compuestas obligatorias:
   ```kotlin
   @Entity(
       tableName = "cached_shows",
       primaryKeys = ["serverId", "profileId", "id"]
   )
   ```
2. **Protección de Perfiles Infantiles (Kids Profile)**:
   - Los datos cacheados de un perfil adulto nunca se muestran al cambiar a un perfil infantil.
   - Si un usuario cambia a un perfil Kids, la navegación limpia el backstack y realiza una consulta limpia con el token infantil al backend.
   - El backend mantiene la autoridad definitiva devolviendo `403 Forbidden` ante cualquier intento de acceso no autorizado.

---

## 4. Seguridad de Red y Detección de Orígenes

1. **Sin Certificados Inseguros**:
   - Está prohibido el uso de `TrustAllCerts` o `hostnameVerifier = { _, _ -> true }`.
   - Si un servidor HTTPS presenta un certificado autofirmado no confiable o caducado, la aplicación rechaza la conexión e informa al usuario con un mensaje de diagnóstico claro.
2. **Tráfico Cleartext HTTP Deliberado y Restringido**:
   - `network_security_config.xml` permite HTTP plano únicamente para entornos LAN y self-hosted configurados por el usuario.
   - `SafeOriginInterceptor` verifica que todas las solicitudes y redirecciones se mantengan dentro del host y puerto explícitamente configurados.
3. **Redacción de Cabeceras Sensibles**:
   - En compilaciones Debug, `HttpLoggingInterceptor` redacta automáticamente las cabeceras `Authorization`, `Cookie`, `Set-Cookie` y `X-Stream-Capability`.
   - En compilaciones Release, el registro de cuerpo de red (`body logging`) está completamente desactivado.

---

## 5. Diagnóstico Sanitizado

En la pantalla de **Ajustes > Diagnóstico del Sistema**, el usuario dispone de un botón **Copiar diagnóstico** para facilitar el soporte técnico. Este reporte elimina automáticamente contraseñas, PINs, tokens JWT, cookies y tickets de sesión, exportando únicamente:
- URL del servidor sanitizada (sin query params).
- Estado del endpoint `/api/health` y latencia en ms.
- Versión de la app y Android SDK.
- Modelo de dispositivo y estado de permisos LAN.
