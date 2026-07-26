# Especificación de Diseño: Tráiler Cinematográfico de Fondo en Detalles

**Fecha**: 2026-07-26  
**Estado**: Aprobado por el usuario  
**Autor**: Antigravity

---

## 1. Contexto y Objetivos

KuraStream reproduce bucles locales de video en la página de detalles de una serie o película si están configurados en la base de datos. Sin embargo, para la mayoría de los títulos no hay bucles de video locales importados, mostrando solo una imagen de fondo fija y borrosa.

El objetivo es aprovechar la clave de tráiler de YouTube (`trailer_key`) existente en la base de datos para cargar un tráiler nítido, silenciado y en bucle en el fondo de la pantalla de detalles (estilo Netflix cinematográfico) con una atenuación de brillo para garantizar la legibilidad del texto en primer plano.

## 2. Modificaciones del Markup y UI

### HTML (`frontend/index.html`)
Se introduce un contenedor y un iframe de YouTube dentro de la sección de fondo ambiental `.detail-ambient-bg`:
```html
<div class="detail-ambient-bg">
  <video id="detail-bg-video" loop muted playsinline></video>
  <div id="detail-bg-youtube-container" class="detail-bg-youtube-container" style="display: none;">
    <iframe id="detail-bg-youtube-iframe" src="" allow="autoplay; encrypted-media" frameborder="0"></iframe>
  </div>
</div>
```

### CSS (`frontend/style.css`)
Estilos para lograr el comportamiento de cubrimiento de pantalla (*crop/cover*) en el iframe y atenuar el brillo:
```css
.detail-bg-youtube-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  z-index: 1;
  pointer-events: none;
}

#detail-bg-youtube-iframe {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100vw;
  height: 56.25vw;
  min-height: 100vh;
  min-width: 177.77vh;
  transform: translate(-50%, -50%) scale(1.2);
  pointer-events: none;
  border: none;
  filter: brightness(0.35) saturate(120%);
}
```

## 3. Comportamiento en Controlador (`frontend/app.js`)

* **Carga**: Al procesar `loadShowDetails(id)`:
  * Si no hay bucles locales en el show pero existe `trailer_key`, se inyecta la URL del tráiler silencioso:
    `https://www.youtube.com/embed/${show.trailer_key}?autoplay=1&mute=1&controls=0&loop=1&playlist=${show.trailer_key}&playsinline=1&showinfo=0&rel=0&iv_load_policy=3`
  * Se muestra el contenedor de YouTube (`display = 'block'`) y se oculta el video local.
  * Si existe bucle local, se oculta el de YouTube y se reproduce el local.
* **Destrucción**: Al salir de la vista (en `handleRoute` o funciones de des-ruteo):
  * Se vacía el `src` del iframe para cortar inmediatamente la conexión y liberar recursos de red y memoria.
