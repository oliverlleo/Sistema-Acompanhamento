const TABLE_SCROLL_SELECTOR = [
  '#view .table-wrap',
  '#view [class*="table-wrap"]',
  '#view .preview-table',
  '#modalRoot .table-wrap',
  '#modalRoot [class*="table-wrap"]',
  '#modalRoot .preview-table'
].join(',');

const bindings = new WeakMap();
let refreshQueued = false;

function updateTopBar(container, state) {
  if (!container.isConnected || !state.top.isConnected) return;

  const overflow = container.scrollWidth > container.clientWidth + 1;
  state.top.hidden = !overflow;
  if (!overflow) return;

  state.spacer.style.width = `${container.scrollWidth}px`;
  if (Math.abs(state.top.scrollLeft - container.scrollLeft) > 1) {
    state.syncing = true;
    state.top.scrollLeft = container.scrollLeft;
    state.syncing = false;
  }
}

function bindContainer(container) {
  if (bindings.has(container)) {
    updateTopBar(container, bindings.get(container));
    return;
  }

  const top = document.createElement('div');
  top.className = 'table-scroll-top';
  top.setAttribute('aria-label', 'Rolagem horizontal da tabela');
  top.setAttribute('role', 'region');
  top.tabIndex = 0;

  const spacer = document.createElement('div');
  spacer.className = 'table-scroll-top-spacer';
  top.appendChild(spacer);
  container.insertAdjacentElement('beforebegin', top);

  const state = { top, spacer, syncing: false, resizeObserver: null };
  bindings.set(container, state);

  top.addEventListener('scroll', () => {
    if (state.syncing) return;
    state.syncing = true;
    container.scrollLeft = top.scrollLeft;
    state.syncing = false;
  }, { passive: true });

  container.addEventListener('scroll', () => {
    if (state.syncing) return;
    state.syncing = true;
    top.scrollLeft = container.scrollLeft;
    state.syncing = false;
  }, { passive: true });

  if ('ResizeObserver' in window) {
    state.resizeObserver = new ResizeObserver(() => updateTopBar(container, state));
    state.resizeObserver.observe(container);
    const table = container.querySelector('table');
    if (table) state.resizeObserver.observe(table);
  }

  updateTopBar(container, state);
}

function refreshTableScrollBars() {
  refreshQueued = false;
  document.querySelectorAll(TABLE_SCROLL_SELECTOR).forEach(bindContainer);
}

function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(refreshTableScrollBars);
}

const roots = [document.querySelector('#view'), document.querySelector('#modalRoot')].filter(Boolean);
roots.forEach(root => {
  new MutationObserver(queueRefresh).observe(root, { childList: true, subtree: true });
});

window.addEventListener('resize', queueRefresh, { passive: true });
window.addEventListener('obraflow:sidebar-layout-change', queueRefresh);
queueRefresh();
