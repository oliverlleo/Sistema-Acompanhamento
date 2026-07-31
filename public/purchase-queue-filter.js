const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const view = $('#view');
let scheduled = 0;

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function emptyCard() {
  let card = $('#purchaseQueueEmpty', view);
  if (card) return card;

  card = document.createElement('div');
  card.id = 'purchaseQueueEmpty';
  card.className = 'card';
  card.innerHTML = '<div class="empty"><div><div class="empty-icon">✓</div><h3>Nenhum item aguardando compra</h3><p>Os itens já comprados ficam somente na tela Recebimento.</p></div></div>';
  const toolbar = $('.toolbar', view);
  toolbar?.insertAdjacentElement('afterend', card);
  return card;
}

function applyPurchaseQueueRule() {
  if (!view || currentRoute() !== 'compras') return;

  const table = $('.data-table', view);
  const tableWrap = table?.closest('.table-wrap');
  if (!table || !tableWrap) return;

  $$('tbody tr', table).forEach(row => {
    const action = $('[data-quick-action]', row)?.dataset.quickAction || '';
    if (action && action !== 'purchase') row.remove();
  });

  const remaining = $$('tbody tr', table).length;
  const counter = $('.toolbar .status-pill.status-neutral', view);
  if (counter) counter.textContent = `${remaining} item(ns)`;

  if (remaining) {
    tableWrap.hidden = false;
    $('#purchaseQueueEmpty', view)?.remove();
  } else {
    tableWrap.hidden = true;
    emptyCard();
  }
}

function scheduleApply(delay = 0) {
  clearTimeout(scheduled);
  scheduled = setTimeout(applyPurchaseQueueRule, delay);
}

if (view) {
  // Observa somente a troca direta da tela feita pelo app. Alterações nas linhas
  // não voltam a disparar este observador, evitando repetição e travamento.
  new MutationObserver(() => scheduleApply(0)).observe(view, { childList: true });
}

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="compras"]')) scheduleApply(100);
});

window.addEventListener('hashchange', () => scheduleApply(80));
scheduleApply(0);
setTimeout(() => scheduleApply(0), 300);
