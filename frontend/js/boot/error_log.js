// Sends uncaught errors to the server log (/api/debug-log) and also handles broken images:
// a failed <img> (poster, avatar, backdrop) is replaced by its placeholder, which replaces the inline onerror="" attributes.
(function () {
  function sendLog(type, msg, stack) {
    fetch('/api/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type, message: msg, stack: stack || '' })
    }).catch(function () {});
  }
  window.onerror = function (message, source, lineno, colno, error) {
    sendLog('WINDOW_ERROR', message + ' at ' + source + ':' + lineno + ':' + colno, error ? error.stack : '');
    return false;
  };
  window.onunhandledrejection = function (event) {
    sendLog('UNHANDLED_REJECTION', event.reason ? (event.reason.message || event.reason) : 'Promise rejected', event.reason ? event.reason.stack : '');
  };
  var originalConsoleError = console.error;
  console.error = function () {
    originalConsoleError.apply(console, arguments);
    var args = Array.prototype.slice.call(arguments).map(function (a) {
      if (a instanceof Error) return a.message + '\n' + a.stack;
      if (typeof a === 'object') return JSON.stringify(a);
      return String(a);
    }).join(' ');
    sendLog('CONSOLE_ERROR', args);
  };

  // Broken images: placeholder (data-fallback-src) or swap to a fallback element (data-error-hide-show).
  // 'error' does not bubble, so capture. Runs from <head>, before the first image fails.
  document.addEventListener('error', function (event) {
    var img = event.target;
    if (!img || img.tagName !== 'IMG') return;
    var fallback = img.getAttribute('data-fallback-src');
    if (fallback && img.getAttribute('src') !== fallback) {
      img.setAttribute('src', fallback);
      return;
    }
    var show = img.getAttribute('data-error-hide-show');
    if (show) {
      img.style.display = 'none';
      var el = document.getElementById(show);
      if (el) el.style.display = 'inline-flex';
    }
  }, true);

  // Links that only trigger a script (href="#") must not change the page's address.
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href="#"]') : null;
    if (link) event.preventDefault();
  });
})();
