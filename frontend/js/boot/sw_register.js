// Registers the service worker (PWA: offline shell) and offers a new version instead of swapping it silently.
// The worker only activates when the person presses "Actualizar", so a tab is never left with half of one release
// and half of another.
(function () {
  if (!('serviceWorker' in navigator)) return;

  function showUpdateBanner(worker) {
    if (document.getElementById('app-update-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'app-update-banner';
    banner.className = 'app-update-banner';
    banner.setAttribute('role', 'status');
    var text = document.createElement('span');
    text.textContent = 'Hay una nueva versión de KuraStream.';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-primary';
    button.textContent = 'Actualizar';
    button.addEventListener('click', function () {
      button.disabled = true;
      worker.postMessage('SKIP_WAITING');
    });
    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn btn-secondary';
    dismiss.textContent = 'Luego';
    dismiss.addEventListener('click', function () { banner.remove(); });
    banner.appendChild(text);
    banner.appendChild(button);
    banner.appendChild(dismiss);
    document.body.appendChild(banner);
  }

  window.addEventListener('load', function () {
    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // The first install also claims the page; only an update from a previous version needs a reload.
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('/sw.js')
      .then(function (registration) {
        if (registration.waiting && navigator.serviceWorker.controller) {
          showUpdateBanner(registration.waiting);
        }
        registration.addEventListener('updatefound', function () {
          var installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', function () {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(installing);
            }
          });
        });
      })
      .catch(function (error) {
        console.warn('[PWA] Service Worker registration failed:', error);
      });
  });
})();
