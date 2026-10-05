/**
 * Inline Lucide icons built from the vendored icon data (window.lucide.icons).
 * Swapping an icon is then a plain innerHTML assignment instead of a document-wide
 * lucide.createIcons() scan, which matters on the old PCs the app has to run on.
 */

const svgCache = new Map();

function toPascalCase(name) {
  return String(name).replace(/(^|-)([a-z0-9])/g, (_, __, char) => char.toUpperCase());
}

function attrsToString(attrs) {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, '&quot;')}"`)
    .join(' ');
}

function nodeToString([tag, attrs, children]) {
  const inner = Array.isArray(children) ? children.map(nodeToString).join('') : '';
  return `<${tag} ${attrsToString(attrs || {})}>${inner}</${tag}>`;
}

/**
 * SVG markup for a Lucide icon (kebab-case name, e.g. "skip-forward").
 * Falls back to a <i data-lucide> placeholder when the bundle is not loaded yet.
 */
export function iconSvg(name, { size = 24, strokeWidth = 2, className = '' } = {}) {
  const key = `${name}|${size}|${strokeWidth}|${className}`;
  if (svgCache.has(key)) return svgCache.get(key);

  const lucide = typeof window !== 'undefined' ? window.lucide : null;
  const node = lucide && lucide.icons ? lucide.icons[toPascalCase(name)] : null;
  if (!node) {
    return `<i data-lucide="${name}"${className ? ` class="${className}"` : ''}></i>`;
  }

  const classes = ['lucide', `lucide-${name}`, className].filter(Boolean).join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${classes}" aria-hidden="true">${node.map(nodeToString).join('')}</svg>`;
  svgCache.set(key, svg);
  return svg;
}

/** Replaces the content of `el` with the given icon (no-op when it is already showing it). */
export function setIcon(el, name, options) {
  if (!el || el.dataset.icon === name) return;
  el.dataset.icon = name;
  el.innerHTML = iconSvg(name, options);
}

/** Converts pending <i data-lucide> placeholders, scanning only `root` when given. */
export function hydrateIcons(root) {
  if (typeof window === 'undefined' || !window.lucide || typeof window.lucide.createIcons !== 'function') return;
  if (root) window.lucide.createIcons({ root });
  else window.lucide.createIcons();
}

if (typeof window !== 'undefined') {
  window.kuraIcon = iconSvg;
}
