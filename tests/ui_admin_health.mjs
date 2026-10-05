// The admin health card renders server data with textContent only (hostile values stay text), and handles missing data.
import assert from 'node:assert/strict';
import test from 'node:test';

class FakeElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.className = ''; this._text = ''; this.listeners = {}; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  appendChild(child) { this.children.push(child); return child; }
  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
globalThis.window = {};
const { renderSystemHealth, renderJobList, renderBackupList, formatBytes } = await import('../frontend/js/modules/admin_status.js');

const health = {
  processes: { ffmpeg: 2, php_fpm: 9 }, party_viewers: 7, load_average: [0.5, 0.4, 0.3], cpu_cores: 4,
  disk: { library: { free_bytes: 50 * 1024 ** 3, total_bytes: 500 * 1024 ** 3, used_percent: 90 }, backups: null },
  direct_play_offload: true, server_software: 'nginx', backups: { available: true, last_at: null },
  jobs: { queued: 1, running: 1, failed_24h: 2 }, migrations_ok: false,
};

test('health tiles show the numbers and flag what needs attention', () => {
  const grid = new FakeElement('div');
  renderSystemHealth(grid, health, { active: 2, max: 2 });
  const text = grid.textContent;
  assert.ok(text.includes('2 / 2') && text.includes('7') && text.includes('50.0 GB libres (90% usado)') && text.includes('Activa'));
  assert.ok(text.includes('0.5 / 0.4 / 0.3 · 4 núcleos'));
  const warned = grid.children.filter((c) => c.className.includes('is-warn')).length;
  assert.ok(warned >= 4, 'full transcoder, 90% disk, no backup, failed jobs, failed migration are highlighted');
  assert.ok(text.includes('Una migración falló'));
});

test('hostile job and backup text stays text', () => {
  const list = new FakeElement('ul');
  renderJobList(list, [{ type: '<img src=x onerror=alert(1)>', status: 'failed', progress: 0, error: '<script>x</script>' }]);
  assert.ok(list.textContent.includes('<img src=x onerror=alert(1)>') && list.textContent.includes('<script>x</script>'));
  assert.equal(list.children[0].tagName, 'li');
  const empty = new FakeElement('ul');
  renderJobList(empty, []);
  assert.ok(empty.textContent.includes('Todavía no hay trabajos'));
  const backups = new FakeElement('ul');
  let clicked = null;
  renderBackupList(backups, [{ file: 'kurastream-20260101-000000.sql.gz', size: 2048, modified: 1767225600 }], (file) => { clicked = file; });
  backups.children[0].children[1].listeners.click();
  assert.equal(clicked, 'kurastream-20260101-000000.sql.gz');
});

test('byte formatting', () => {
  assert.equal(formatBytes(512), '1 KB');
  assert.equal(formatBytes(5 * 1024 ** 2), '5.0 MB');
  assert.equal(formatBytes(3 * 1024 ** 4), '3.0 TB');
});
