// Lightweight mode must be decided before the first paint (no flash of heavy glass effects).
// Loaded as a plain blocking script in <head>; kept out of index.html so the page needs no inline scripts.
(function () {
  try {
    var mode = localStorage.getItem('kurastream_perf_mode'); // 'lite' | 'full' | null (auto)
    var lowEnd = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
      (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches);
    if (mode === 'lite' || (mode !== 'full' && lowEnd)) {
      document.documentElement.className += (document.documentElement.className ? ' ' : '') + 'perf-lite';
    }
  } catch { /* storage blocked: keep full mode */ }
})();
