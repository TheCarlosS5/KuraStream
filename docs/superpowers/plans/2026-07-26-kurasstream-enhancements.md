# Plan de Implementación: Mejoras Robustas en KuraStream

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar las recomendaciones solicitadas (excepto la gestión de base de datos) para llevar KuraStream a un nivel de madurez y preparación de producción excelente.

**Architecture:**
- **Gestión de Configuración**: Creación de `package.json`, `.env.example`, `.env`, `.eslintrc.json`, `.prettierrc` y `README.md`.
- **Autenticación Segura**: Hashing nativo de contraseñas mediante `node:crypto.scryptSync` y firma/validación de tokens JWT mediante `node:crypto.createHmac` en `backend/server.js`.
- **Middleware Global de Errores**: Captura centralizada de códigos 404 y 500 retornando JSON estructurado en el backend.
- **Visuales & Metadatos**: Favicon SVG en línea y metadatos de accesibilidad/descripción en `frontend/index.html`.
- **Control de Errores**: Manejador interactivo de fallas de red/reproducción con botón "Reintentar" en `frontend/player.js`.
- **DevOps / Contenedores**: Configuración de `Dockerfile` y `docker-compose.yml` para despliegues portables y configurables.
- **Suite de Pruebas**: Pruebas automáticas nativas en `tests/backend.test.js` utilizando la suite `node:test` incorporada en Node.js.

---

## Global Constraints

- **No modificar** la base de datos `kurastream.db` existente ni su flujo en git (ignorar la recomendación de base de datos tal como indicó el usuario).
- **No realizar** comandos `git commit` bajo ninguna circunstancia.

---

### Task 1: Archivos de Configuración y Gestión de Dependencias

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.env`
- Create: `.eslintrc.json`
- Create: `.prettierrc`
- Create: `README.md`

- [x] **Step 1: Crear el archivo package.json**
Crear el archivo en la raíz del proyecto para definir scripts, tipo de módulo y la versión mínima de Node.js:
```json
{
  "name": "kurastream",
  "version": "1.5.0",
  "description": "Centro de entretenimiento offline premium para anime, películas y series.",
  "type": "module",
  "main": "backend/server.js",
  "scripts": {
    "start": "node --env-file=.env backend/server.js",
    "dev": "node --env-file=.env --watch backend/server.js",
    "test": "node --test tests/**/*.test.js"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

- [x] **Step 2: Crear los archivos de variables de entorno (.env.example y .env)**
Crear `.env.example`:
```env
PORT=3000
JWT_SECRET=super_kura_secret_key_123!
TMDB_API_KEY=
MEDIA_LIBRARY_PATH=./library
```
Crear `.env` con valores por defecto:
```env
PORT=3000
JWT_SECRET=default_kura_secret_key_987654321_hash
TMDB_API_KEY=
MEDIA_LIBRARY_PATH=./library
```

- [x] **Step 3: Crear el formateador y linter config**
Crear `.eslintrc.json`:
```json
{
  "env": {
    "browser": true,
    "es2022": true,
    "node": true
  },
  "extends": "eslint:recommended",
  "parserOptions": {
    "ecmaVersion": "latest",
    "sourceType": "module"
  },
  "rules": {
    "no-unused-vars": "warn",
    "no-console": "off"
  }
}
```
Crear `.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5"
}
```

- [x] **Step 4: Crear un README.md robusto**
Crear `README.md` detallando el proyecto, requerimientos (FFmpeg, Node 22+), instalación y uso de scripts.

---

### Task 2: Robustez de Autenticación, Middleware de Errores y Entorno (Backend)

**Files:**
- Modify: `backend/server.js`

- [ ] **Step 1: Implementar lectura de .env, hashing de contraseñas y firma JWT**
Modificar la inicialización y endpoints de login/registro en `backend/server.js` para usar hashing `scryptSync` y firmas de token usando Hmac SHA256 nativos:
```javascript
import crypto from 'node:crypto';

// Utilidades de Hashing
function hashPassword(password) {
  const salt = 'kurasalt';
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Utilidades de Token JWT Nativo
function signToken(payload) {
  const secret = process.env.JWT_SECRET || 'default_secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
```

- [ ] **Step 2: Agregar Middleware de errores global y 404 en backend/server.js**
Encapsular el enrutador en un bloque try-catch general y agregar un manejador para rutas desconocidas (404) que devuelva JSON:
```javascript
// Al final del router de peticiones:
res.writeHead(404, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ success: false, error: 'Ruta no encontrada (404)' }));
```

---

### Task 3: Metadatos de Frontend y Control de Errores del Reproductor

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/player.js`
- Modify: `frontend/style.css`

- [ ] **Step 1: Agregar Favicon SVG y Meta Description en index.html**
Modificar [frontend/index.html](file:///home/carlossgr/Escritorio/KuraStream/frontend/index.html) para inyectar los metadatos y el favicon en el `<head>`:
```html
  <meta name="description" content="KuraStream - Centro de entretenimiento local offline premium.">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🍁</text></svg>">
```

- [ ] **Step 2: Crear Overlay de Error en player.js con botón de Reintentar**
Modificar [frontend/player.js](file:///home/carlossgr/Escritorio/KuraStream/frontend/player.js) para escuchar `video.onerror`, mostrar un cartel estilizado de fallo de red/reproducción y re-cargar el stream en la última posición guardada al hacer clic en "Reintentar".

---

### Task 4: Contenedorización y Suite de Pruebas Automáticas (DevOps)

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `tests/backend.test.js`

- [ ] **Step 1: Crear Dockerfile y docker-compose.yml**
Crear el Dockerfile para empaquetar KuraStream con Node.js 22 y FFmpeg instalado en Alpine/Debian slim.
Crear `docker-compose.yml` mapeando puertos, la base de datos y la carpeta `library/`.

- [ ] **Step 2: Crear pruebas automáticas usando el test runner de Node.js**
Crear `tests/backend.test.js` que pruebe el servidor local y los endpoints principales (`/api/shows`, `/api/login`, etc.).
