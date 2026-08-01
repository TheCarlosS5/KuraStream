# Especificación de Diseño: Perfiles Multiusuario y Control Parental en KuraStream

Esta especificación detalla la implementación técnica para incorporar un sistema de perfiles multiusuario (estilo Netflix) con control parental y sincronización de preferencias en la red local.

---

## 1. Modelo de Datos y Esquema DB (`backend/db.js`)

Crearemos una nueva tabla `profiles` y migraremos las relaciones de historial, favoritos y preferencias para que dependan del contexto de perfil (`(username, profile_name)`).

### Nueva Tabla `profiles`
```sql
CREATE TABLE IF NOT EXISTS profiles (
  username TEXT NOT NULL,
  profile_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#a855f7',
  is_kids INTEGER NOT NULL DEFAULT 0, -- 0 = Adulto, 1 = Infantil
  pin TEXT, -- Opcional: PIN de 4 dígitos para perfiles de adultos
  pref_audio_lang TEXT NOT NULL DEFAULT 'default',
  pref_sub_lang TEXT NOT NULL DEFAULT 'default',
  PRIMARY KEY (username, profile_name),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
```

### Modificación de Tablas Existentes (Migración)
* **`watch_history`**: Se añade la columna `profile_name` para registrar el progreso individual.
  ```sql
  ALTER TABLE watch_history ADD COLUMN profile_name TEXT NOT NULL DEFAULT 'Principal';
  ```
  La llave primaria compuesta pasará a ser: `(username, profile_name, episode_id)`.

* **`favorites`**: Se añade la columna `profile_name`.
  ```sql
  ALTER TABLE favorites ADD COLUMN profile_name TEXT NOT NULL DEFAULT 'Principal';
  ```
  La llave primaria compuesta pasará a ser: `(username, profile_name, show_id)`.

---

## 2. API Endpoints (`backend/server.js`)

Añadiremos rutas HTTP para gestionar los perfiles bajo la autenticación del usuario actual (JWT token).

### Endpoints de Gestión
* **`GET /api/profiles`**: Obtiene todos los perfiles asociados a la cuenta del usuario logueado.
* **`POST /api/profiles`**: Crea un nuevo perfil.
  * *Body:* `{ profile_name, avatar_color, is_kids, pin }`
* **`PUT /api/profiles/:profile_name`**: Edita un perfil existente (cambio de avatar, nombre, PIN o modo infantil).
* **`DELETE /api/profiles/:profile_name`**: Elimina un perfil y limpia en cascada su historial y favoritos.

### Endpoints de Sesión de Perfil
* **`POST /api/profiles/select`**: Selecciona el perfil activo en la sesión.
  * *Body:* `{ profile_name, pin }`
  * *Comportamiento:* Genera un nuevo token JWT que contiene tanto el `username` como el `profile_name` activos, firmados de forma segura.

---

## 3. Lógica de Control Parental en Servidor

Cuando un perfil infantil (`is_kids = 1`) está activo en el token JWT:
* La ruta `/api/shows` y las búsquedas filtrarán automáticamente cualquier contenido cuya clasificación de edad (`age_rating` o similar) sea **TV-MA** o **R**.
* El servidor devolverá error `403 Forbidden` si se intenta reproducir un episodio de un show clasificado para adultos desde un perfil restringido.

---

## 4. Interfaz de Usuario y Flujos (`frontend/`)

### Pantalla de Selección de Perfil
* Al iniciar sesión o refrescar la página, se desplegará una pantalla completa glassmorphic ("¿Quién está viendo?") antes de cargar el catálogo.
* Muestra tarjetas circulares con las iniciales del perfil y su color de fondo asignado.
* Si el perfil seleccionado tiene PIN, abrirá un prompt numérico sencillo.

### Menú de Cuenta en Header
* El menú desplegable del usuario mostrará el nombre del perfil activo.
* Se añadirá una opción **"Cambiar de Perfil"** que reabre la pantalla de selección al instante.

### Configuración del Perfil (`#/settings`)
* Las preferencias de audio y subtítulos modificadas en Ajustes se guardarán en la base de datos para el perfil activo en lugar de guardarse de forma aislada en `LocalStorage`.

---

## 5. Pruebas y Criterios de Aceptación
1. **Sincronización:** El historial de reproducción de un perfil no debe mezclarse con el de otros perfiles de la misma cuenta.
2. **Restricción Infantil:** Al usar un perfil infantil, las series para adultos como *Oshi no Ko* o películas TV-MA deben desaparecer del catálogo. El acceso a su API directa debe ser bloqueado por el servidor.
3. **Persistencia local y remota:** Al cambiar de navegador o dispositivo, los perfiles y su respectivo historial deben mantenerse idénticos tras iniciar sesión.
