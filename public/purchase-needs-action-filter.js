const PURCHASE_FILTER = 'comprar';

let needsActionFilterActive = false;
let bypassNativeChange = false;
let patchQueued = false;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(() => setTimeout(patchFilter, 0));
}

function activateNeedsActionFilter(select) {
  if (!select || currentRoute() !== 'compras') return;

  needsActionFilterActive = true;
  bypassNativeChange = true;

  // A própria rota Compras já contém todos os materiais cuja parcela de
  // compra ainda precisa ser registrada, inclusive Compra + estoque em
  // Atendimento parcial. Mantemos o filtro interno em "todos" e exibimos
  // "Precisa comprar" ao usuário para não excluir esses materiais mistos.
  select.value = 'todos';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  setTimeout(queuePatch, 0);
}

function patchFilter() {
  patchQueued = false;

  if (currentRoute() !== 'compras') {
    needsActionFilterActive = false;
    bypassNativeChange = false;
    return;
  }

  const select = document.querySelector('#statusFilter');
  if (!select) return;

  if (needsActionFilterActive) {
    if (select.value !== PURCHASE_FILTER) select.value = PURCHASE_FILTER;
    select.title = 'Mostra toda parcela de compra ainda não registrada, inclusive materiais Compra + estoque em Atendimento parcial.';
    return;
  }

  // Também corrige o estado persistido quando a tela é aberta já com
  // "Precisa comprar" selecionado.
  if (select.value === PURCHASE_FILTER) activateNeedsActionFilter(select);
}

document.addEventListener('change', event => {
  const select = event.target;
  if (select?.id !== 'statusFilter' || currentRoute() !== 'compras') return;

  if (bypassNativeChange) {
    bypassNativeChange = false;
    return;
  }

  if (select.value === PURCHASE_FILTER) {
    event.preventDefault();
    event.stopImmediatePropagation();
    activateNeedsActionFilter(select);
    return;
  }

  needsActionFilterActive = false;
  setTimeout(queuePatch, 0);
}, true);

document.addEventListener('click', event => {
  const routeButton = event.target.closest?.('[data-route]');
  if (!routeButton) return;

  if (routeButton.dataset.route !== 'compras') {
    needsActionFilterActive = false;
    bypassNativeChange = false;
    return;
  }

  setTimeout(queuePatch, 80);
  setTimeout(queuePatch, 300);
});

window.addEventListener('hashchange', queuePatch);

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });

queuePatch();
