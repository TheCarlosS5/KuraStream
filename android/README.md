# KuraStream Native Android Client

Cliente nativo de primera clase para **KuraStream** construido en **Kotlin** y **Jetpack Compose**, diseñado específicamente para teléfonos y tabletas Android desde **Android 8.0 (API 26)** hasta **Android 17 (API 37)**.

---

## 1. Requisitos del Entorno

- **JDK**: Java Development Kit 21 LTS (ej. Microsoft Build of OpenJDK 21 o Eclipse Temurin 21).
- **Android SDK**:
  - `compileSdk`: **36** (AGP 8.8.2 no soporta oficialmente 37; la app sigue apuntando a Android 17 con `targetSdk` 37)
  - `targetSdk`: **37** (Android 17)
  - `minSdk`: **26** (Android 8.0 Oreo)
  - Plataforma instalada: `platforms;android-36`
- **Gradle**: 8.12 (gestionado vía Gradle Wrapper `./gradlew`; en Linux, `chmod +x gradlew` o `sh gradlew`).
- **Android Gradle Plugin (AGP)**: 8.8.2 (`android.suppressUnsupportedCompileSdk=36` en `gradle.properties`).

---

## 2. Apertura y Configuración del Proyecto

1. Clona el repositorio si no lo has hecho:
   ```bash
   git clone https://github.com/TheCarlosS5/KuraStream.git
   cd KuraStream/android
   ```
2. Abre la carpeta `android/` en **Android Studio Ladybug (o superior)** o en tu IDE preferido con soporte para Gradle/Kotlin.
3. Configura `local.properties` con la ruta de tu Android SDK:
   ```properties
   sdk.dir=C\:\\Users\\<TuUsuario>\\AppData\\Local\\Android\\Sdk
   ```

---

## 3. Compilación y Construcción

### Generar APK de Debug
```bash
./gradlew assembleDebug
```
El archivo generado se ubicará en:
`android/app/build/outputs/apk/debug/app-debug.apk`

### Generar APK de Release (con optimización R8 y minificación activas)
```bash
./gradlew assembleRelease
```
El build release utiliza las reglas definidas en `android/app/proguard-rules.pro` para serialización JSON, Retrofit, Hilt, Media3 y Room.

---

## 4. Instalación en Dispositivo o Emulador

Conecta tu dispositivo vía USB o inicia un emulador:
```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 5. Conexión al Servidor KuraStream

La aplicación soporta cualquier origen válido de KuraStream:
- Servidores públicos con dominio y HTTPS: `https://anime.midominio.com`
- Servidores con puerto personalizado: `https://stream.server.org:8443`
- Servidores locales en LAN: `http://192.168.1.100:3000` o `http://10.0.0.15:3000`
- Hostnames locales: `http://kurastream.local:3000`

### Validación con `/api/health`
Al ingresar la URL del servidor y presionar **Conectar**, la aplicación realiza una comprobación con `GET /api/health`. No utiliza `/api/shows` como ping, garantizando que el estado de conectividad sea independiente del estado de autenticación de usuario o perfil.

### Normalización de URLs
- Se eliminan barras finales innecesarias.
- Se preserva el puerto original.
- Se rechazan protocolos ajenos a `http` y `https` (como `ftp://` o `file://`).
- Direcciones IP introducidas sin esquema reciben automáticamente el prefijo `http://`.

---

## 6. Red Local (LAN) y Redes sin Internet

KuraStream está pensado para entornos self-hosted y multimedia domésticos. Por ello:
- **Hotspots Wi-Fi sin salida a Internet**: La aplicación **no** bloquea la navegación cuando Android reporta "Conexión sin Internet". Si el origen KuraStream responde por la red local, el catálogo, la autenticación, la reproducción y la Watch Party funcionan al 100%.
- **Permiso `ACCESS_LOCAL_NETWORK` en Android 17**: La aplicación declara y solicita en tiempo de ejecución el permiso para interactuar con la subred doméstica cuando se detecta una dirección IP privada (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x` o `.local`). Si el usuario no otorga el permiso, la app muestra un diálogo explicativo con opción de reintentar sin crashear.

---

## 7. HTTP Local, HTTPS y Network Security

- **Cleartext HTTP para LAN**: Android 9+ bloquea por defecto el tráfico HTTP plano. KuraStream incluye `res/xml/network_security_config.xml` configurado para admitir tráfico cleartext hacia los orígenes configurados por el usuario, mostrando una advertencia discreta de "Conexión no cifrada".
- **Sin Bypass Inseguro de TLS**: No se implementan certificados comodín (`TrustAllCerts`) ni bypasses de `hostnameVerifier`. Las conexiones HTTPS requieren certificados válidos para garantizar la seguridad del usuario.
- **Sin redirecciones no autorizadas**: `SafeOriginInterceptor` previene que un servidor redirija silenciosamente las peticiones a un dominio externo o sospechoso.

---

## 8. Ejecución de Pruebas

### Pruebas Unitarias de Android (38 tests)
```bash
cd android
./gradlew testDebugUnitTest
```

### Análisis Estático de Código con Android Lint
```bash
./gradlew lintDebug
```

### Verificación de Contratos y Arquitectura
```bash
cd ..
node scripts/test_android_contracts.mjs
```

### Suite Completa del Backend PHP (41 tests)
```bash
npm test
```

---

## 9. Firma para Producción (Signing Release)

Para firmar builds de producción sin comprometer credenciales en el repositorio:
1. Genera tu keystore personal:
   ```bash
   keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias kurastream
   ```
2. Define las siguientes variables en `~/.gradle/gradle.properties` o mediante variables de entorno en tu pipeline de CI:
   ```properties
   KURA_KEYSTORE_FILE=/path/to/release.jks
   KURA_KEYSTORE_PASSWORD=tu_password_keystore
   KURA_KEY_ALIAS=kurastream
   KURA_KEY_PASSWORD=tu_password_key
   ```
3. Ejecuta `./gradlew assembleRelease`. Si no hay keystore (`KURA_KEYSTORE_FILE` inexistente o sin definir) el build **falla** con un mensaje claro: un APK sin firmar no se puede instalar. `assembleDebug`, los tests y lint no necesitan keystore. (Los nombres antiguos `KURASTREAM_*` siguen funcionando.)

> **Guarda una copia segura del keystore y sus contraseñas.** Android solo instala una actualización si el APK está firmado con la misma clave; si la pierdes, los usuarios tendrán que desinstalar la app y perderán sus datos locales.

### Publicar el APK en tu servidor

1. Genera el APK firmado (`KuraStream.apk`) y los metadatos junto a él:
   ```bash
   cp android/app/build/outputs/apk/release/app-release.apk KuraStream.apk
   node scripts/generate_app_release.mjs KuraStream.apk --variant release --notes "Novedades de esta versión"
   ```
   Esto crea `app-release.json` (versión, `versionCode`, variante y notas) y muestra el SHA-256.
2. Copia ambos archivos a la raíz del servidor (o apunta `ANDROID_APK_PATH` / `ANDROID_APP_RELEASE_JSON` a ellos).
3. La página `#/app` y `GET /api/app/android` muestran la versión y la **huella SHA-256 del archivo que realmente se sirve** (el servidor la calcula; el JSON nunca puede avalar otro archivo), y la descarga incluye la cabecera `X-Content-SHA256`. En una red compartida, compara esa huella con la del instalador descargado.

La CI (`.github/workflows/ci.yml`, job `android-release`) hace lo mismo tras cada merge a `main` **cuando existen** los secretos `KURA_KEYSTORE_BASE64` (el `.jks` en base64), `KURA_KEYSTORE_PASSWORD`, `KURA_KEY_ALIAS` y `KURA_KEY_PASSWORD`; sin ellos el job se omite. El resultado queda como artefacto `kurastream-android-release`.

### Migrar desde la versión de pruebas (debug)

La variante debug se instala como `com.kurastream.app.debug`, la final como `com.kurastream.app`: son **dos aplicaciones distintas**. Quien tenga instalada la de pruebas debe desinstalarla antes de usar la versión final (la página de descarga lo avisa cuando el servidor sirve un APK debug).
