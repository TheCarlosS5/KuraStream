/**
 * Keyboard and screen-reader behaviour for every modal dialog, in one place.
 *
 * The modals are shown and hidden by many callers (style.display, hidden, classes). Instead of changing each of
 * them, this watches the overlays and, whenever one becomes visible, gives it what a dialog needs:
 *  - role="dialog" + aria-modal + a name (aria-labelledby from its title),
 *  - focus moves inside, Tab/Shift+Tab cycle within it, Escape closes it (through its own close/cancel button, so
 *    existing cleanup still runs),
 *  - when it closes, focus returns to what had it before.
 */

const OVERLAY_SELECTOR = '.pin-modal-overlay, .trailer-modal-overlay, .player-modal';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CLOSE_SELECTOR = '[data-dialog-close], .modal-close, .trailer-modal-close, .random-modal-close, [id$="-close"], [id$="-cancel"], [id$="close-btn"], [id*="cancel"]';

const open = [];           // visible dialogs, last = topmost: { overlay, previousFocus }
let lastOutsideFocus = null;   // what had focus before any dialog took it (callers focus a field before we get to look)
let idCounter = 0;

function isVisible(el) {
  if (!el || el.hidden || !el.isConnected) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function dialogOf(overlay) {
  if (overlay.getAttribute('role') === 'dialog') return overlay;   // already marked up by the page
  return overlay.querySelector(':scope > [class*="modal"], :scope > .player-modal-card, :scope > div') || overlay;
}

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => isVisible(el) && el.offsetParent !== null);
}

function label(overlay, dialog) {
  if (dialog.hasAttribute('aria-label') || dialog.hasAttribute('aria-labelledby')) return;
  const title = overlay.querySelector('.modal-title, h1, h2, h3');
  if (title) {
    if (!title.id) title.id = `dialog-title-${++idCounter}`;
    dialog.setAttribute('aria-labelledby', title.id);
  }
}

function onShown(overlay) {
  if (open.some((entry) => entry.overlay === overlay)) return;
  const dialog = dialogOf(overlay);
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  label(overlay, dialog);
  if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
  open.push({ overlay, dialog, previousFocus: lastOutsideFocus && lastOutsideFocus.isConnected ? lastOutsideFocus : document.activeElement });
  const inside = focusables(dialog);
  // The first input is where typing starts; a dialog without fields starts on its first button.
  const target = inside.find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) || inside[0] || dialog;
  requestAnimationFrame(() => target.focus({ preventScroll: true }));
}

function onHidden(overlay) {
  const index = open.findIndex((entry) => entry.overlay === overlay);
  if (index === -1) return;
  const [{ previousFocus }] = open.splice(index, 1);
  if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
    previousFocus.focus({ preventScroll: true });
  }
}

function refresh(overlay) {
  if (isVisible(overlay)) onShown(overlay);
  else onHidden(overlay);
}

function onKeydown(event) {
  const top = open[open.length - 1];
  if (!top) return;
  if (event.key === 'Escape') {
    const closer = top.overlay.querySelector(CLOSE_SELECTOR);
    event.stopPropagation();
    event.preventDefault();
    if (closer) closer.click();
    else { top.overlay.style.display = 'none'; top.overlay.hidden = true; refresh(top.overlay); }
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusables(top.dialog);
  if (items.length === 0) { event.preventDefault(); top.dialog.focus(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || !top.dialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !top.dialog.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

let observer = null;

function watch(overlay) {
  if (overlay.dataset.dialogWatched) return;
  overlay.dataset.dialogWatched = '1';
  observer.observe(overlay, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  refresh(overlay);
}

/** Starts managing every modal in the page, including the ones added later. Safe to call more than once. */
export function initDialogs() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') refresh(record.target);
      else record.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches(OVERLAY_SELECTOR)) watch(node);
        node.querySelectorAll?.(OVERLAY_SELECTOR).forEach(watch);
      });
    }
  });
  document.querySelectorAll(OVERLAY_SELECTOR).forEach(watch);
  observer.observe(document.body, { childList: true, subtree: true });
  // Capture phase: a dialog's Escape/Tab must not also reach the player's shortcuts underneath it.
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element && !event.target.closest(OVERLAY_SELECTOR)) lastOutsideFocus = event.target;
  }, true);
}
