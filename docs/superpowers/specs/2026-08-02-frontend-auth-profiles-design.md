# Especificaciones de Diseño: Flujo de Autenticación, Avatares Personalizados y Rediseño Premium de Perfiles

Este documento detalla los requerimientos y la arquitectura para integrar la pantalla de bloqueo de inicio de sesión obligatorio, soporte para subir fotos de perfil personalizadas almacenadas localmente en disco, animaciones de transición tipo Netflix y un rediseño de la sección de perfiles en la barra de navegación de KuraStream.

---

## 1. Arquitectura y Componentes

### 1.1 Flujo de Bloqueo de Pantalla Completa en Carga Inicial
* **Comportamiento:** Al cargar la aplicación, si no existe una clave `kura_user_session` en el almacenamiento local, el router bloqueará cualquier renderizado del Dashboard y forzará la visualización del modal `#login-modal` en pantalla completa como una compuerta de acceso obligatoria (con un fondo difuminado y degradados neón), ocultando la barra de navegación y el chat de la comunidad.
* **Flujo de Navegación:**
  ```mermaid
  graph TD
      A[Carga de Página / URL] --> B{¿Sesión en LocalStorage?}
      B -- No --> C[Bloquear Navegación y Mostrar Login Pantalla Completa]
      B -- Sí --> D[Permitir Catálogo / Mostrar Selector de Perfiles si no hay perfil en token]
      C --> E[Registro exitoso / Login]
      E --> D
  ```

### 1.2 Subida de Fotos de Perfil (Optimizado en Cliente)
* **Control en Cliente (Canvas):** Para evitar subir archivos pesados y respetar el límite de 1MB por petición del servidor, la imagen cargada por el usuario en el modal se procesará localmente en un `<canvas>` oculto:
  * Se recortará en un cuadrado centrado de `200x200px`.
  * Se codificará en un string Base64 (`image/jpeg`, calidad 0.8) que raramente superará los 30 KB.
* **Comunicación API:** El string Base64 se envía en la propiedad `avatar_image` del JSON en peticiones `POST /api/profiles` y `PUT /api/profiles/:name`.
* **Guardado en Servidor:** El servidor de Node decodifica la cadena y crea el archivo en `library/avatars/<username>_<profile_name>_<timestamp>.jpg`. El campo `avatar_color` de la tabla `profiles` se actualiza con la ruta `/library/avatars/<filename>`.
* **Visualización de Avatar en Front-end:** La función `renderProfiles` analizará el valor de `p.avatar_color`. Si comienza con `/library/`, se renderizará el avatar con la imagen de fondo correspondiente, de lo contrario, se usará el color plano con la inicial:
  ```javascript
  const isImage = color.startsWith('/');
  const avatarStyle = isImage 
    ? `background-image: url('${color}'); background-size: cover; background-position: center;` 
    : `background: ${color};`;
  ```

### 1.3 Netflix-Style Profile Selection Animation
* Al hacer clic en un perfil válido (o tras validar su PIN de 4 dígitos):
  1. Se añade la clase `.selected` al perfil elegido. Su avatar escalará (`transform: scale(1.3) translateY(-20px)`) y se moverá suavemente al centro.
  2. Las tarjetas de los demás perfiles y el botón "Administrar perfiles" se desvanecen (`opacity: 0`).
  3. Aparece un spinner neón en el centro para dar retroalimentación de carga.
  4. La vista completa se oscurece y se revela el catálogo.
* **Animaciones CSS:** Implementado con aceleración por hardware (`transition: transform 0.8s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s ease;`).

### 1.4 Temporizador de Inactividad (Auto-Lock)
* **Eventos Rastreados:** `mousemove`, `mousedown`, `keydown`, `click`, `scroll`, `touchstart`.
* **Lógica:** Cada vez que el usuario interactúa, se actualiza la marca de tiempo `lastActivityTime`. Un intervalo en segundo plano revisará la inactividad cada 10 segundos:
  * Si `Date.now() - lastActivityTime > 30 * 60 * 1000` (30 minutos) y hay un perfil seleccionado:
    * Se decodifica el JWT, se limpia el campo `profile_name` y se firma un nuevo token sin perfil (o se restablece la sesión del usuario básica).
    * Se redirige a la pantalla del selector de perfiles y se muestra un toast indicando: *"Sesión de perfil cerrada por inactividad."*

### 1.5 Rediseño Premium del Navbar (Menu Netflix)
* El menú desplegable del avatar del usuario (`#user-dropdown-card`) se rediseña para lucir premium y con amplio espaciado:
  * **Lista de Perfiles:** En la parte superior mostrará el resto de perfiles del usuario con sus fotos o colores. Al hacer clic en uno de ellos, se cambia al perfil seleccionado inmediatamente (solicitando PIN si está configurado).
  * **Acciones secundarias:** Línea divisoria, "Administrar Perfiles", "Ajustes", "Panel de Administración" (si es admin) y "Cerrar Sesión" en color rojo suave.

---

## 2. Plan de Pruebas y Validación

* **Validación Unitaria y de API:** Agregar pruebas en `tests/api_profiles.test.js` para asegurar que el endpoint `/api/profiles` procesa correctamente el envío de la foto en Base64, escribe el archivo JPEG en `library/avatars/` y actualiza la columna de base de datos.
* **Verificación Visual:** Realizar pruebas de flujo en el navegador para comprobar:
  * Bloqueo inicial ante usuarios no autenticados.
  * Transición fluida al elegir perfil (animación sin saltos de layout).
  * Carga y recorte de fotos cuadradas en el modal.
  * Autocierre de sesión al simular inactividad de 30 minutos.
