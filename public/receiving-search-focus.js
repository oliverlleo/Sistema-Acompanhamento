let pendingFocus = null;
let expireTimer = 0;
let restoreQueued = false;

function isReceivingRoute() {
  return location.hash.replace(/^#/, '') === 'recebimento';
}

function receivingSearch() {
  return document.querySelector('#globalReceivingSearch');
}

function restoreFocus() {
  restoreQueued = false;
  if (!pendingFocus || !isReceivingRoute() || Date.now() > pendingFocus.expiresAt) return;

  const input = receivingSearch();
  if (!(input instanceof HTMLInputElement) || input.value !== pendingFocus.value) return;

  input.focus({ preventScroll: true });
  try {
    input.setSelectionRange(
      Math.min(pendingFocus.start, input.value.length),
      Math.min(pendingFocus.end, input.value.length),
      pendingFocus.direction
    );
  } catch {
    // O campo de busca pode estar sendo recriado durante a troca de tela.
  }
}

function queueRestore() {
  if (restoreQueued || !pendingFocus) return;
  restoreQueued = true;
  requestAnimationFrame(() => setTimeout(restoreFocus, 0));
}

function rememberFocus(input) {
  pendingFocus = {
    value: input.value,
    start: input.selectionStart ?? input.value.length,
    end: input.selectionEnd ?? input.selectionStart ?? input.value.length,
    direction: input.selectionDirection || 'none',
    expiresAt: Date.now() + 800
  };

  clearTimeout(expireTimer);
  expireTimer = setTimeout(() => {
    pendingFocus = null;
  }, 850);

  queueRestore();
  setTimeout(queueRestore, 40);
  setTimeout(queueRestore, 120);
}

// Executa na fase de propagação, depois do filtro do Recebimento agendar a renderização.
document.addEventListener('input', event => {
  if (event.target instanceof HTMLInputElement && event.target.id === 'globalReceivingSearch') {
    rememberFocus(event.target);
  }
});

document.addEventListener('search', event => {
  if (event.target instanceof HTMLInputElement && event.target.id === 'globalReceivingSearch') {
    rememberFocus(event.target);
  }
});

document.addEventListener('pointerdown', event => {
  if (!event.target.closest?.('#globalReceivingSearch')) pendingFocus = null;
}, true);

const view = document.querySelector('#view');
if (view) {
  new MutationObserver(() => {
    if (pendingFocus) queueRestore();
  }).observe(view, { childList: true, subtree: true });
}

window.addEventListener('hashchange', () => {
  if (!isReceivingRoute()) pendingFocus = null;
});
