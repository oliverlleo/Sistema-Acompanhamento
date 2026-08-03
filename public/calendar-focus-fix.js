let pendingFocus = null;
let restoreQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function queueRestore() {
  if (restoreQueued || !pendingFocus) return;
  restoreQueued = true;
  requestAnimationFrame(() => {
    restoreQueued = false;
    if (!pendingFocus || currentRoute() !== 'calendario') return;
    const input = document.querySelector(`#${pendingFocus.id}`);
    if (!input) return;
    input.focus({ preventScroll: true });
    if (typeof input.setSelectionRange === 'function') {
      const position = Math.min(pendingFocus.position, input.value.length);
      input.setSelectionRange(position, position);
    }
    pendingFocus = null;
  });
}

document.addEventListener('input', event => {
  const input = event.target;
  if (currentRoute() !== 'calendario' || input?.id !== 'calendarSearch') return;
  pendingFocus = {
    id: input.id,
    position: Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length
  };
  setTimeout(queueRestore, 0);
}, true);

const view = document.querySelector('#view');
if (view) new MutationObserver(queueRestore).observe(view, { childList: true, subtree: true });
