/* Apresentação móvel das tabelas sem substituir linhas ou perder eventos. */
(() => {
  const MOBILE_QUERY = '(max-width: 720px)';
  const TABLE_SELECTOR = [
    '#view .table-wrap:not(.preview-table) > table.data-table',
    '#view .sep-table-wrap > table.sep-table',
    '#view .trk-table-wrap > table.trk-table',
    '#view .gr-table-wrap > table.gr-table'
  ].join(', ');
  const mobile = window.matchMedia(MOBILE_QUERY);
  const view = document.getElementById('view');
  if (!view) return;

  let scheduled = false;

  function decorateTable(table) {
    const headings = Array.from(table.tHead?.rows?.[0]?.cells || [], header => {
      const sortButton = header.querySelector('[data-purchase-sort]');
      return (sortButton?.textContent || header.textContent || '')
        .replace(/[↕↑↓]/g, '').replace(/\s+/g, ' ').trim();
    });
    for (const tbody of table.tBodies) {
      for (const row of tbody.rows) {
        if (!row.cells.length) continue;
        Array.from(row.cells).forEach((cell, index) => {
          if (cell.colSpan > 1) return;
          const label = headings[index] || 'Informação';
          if (cell.dataset.mobileLabel !== label) cell.dataset.mobileLabel = label;
          const action = /^(ação|ações|próxima ação)$/i.test(label)
            || Boolean(cell.querySelector('.cell-actions, [data-global-receive]'));
          if (action && !('mobileActions' in cell.dataset)) cell.dataset.mobileActions = 'true';
          else if (!action && 'mobileActions' in cell.dataset) delete cell.dataset.mobileActions;
        });
      }
    }
  }

  function syncPurchaseSort(table) {
    const headerButtons = [...table.querySelectorAll('thead [data-purchase-sort]')];
    if (!headerButtons.length) return;
    const toolbar = table.closest('.table-wrap')?.previousElementSibling;
    if (!toolbar?.classList.contains('toolbar')) return;
    let select = toolbar.querySelector('#mobilePurchaseSort');
    if (!select) {
      const holder = document.createElement('label');
      holder.className = 'mobile-purchase-sort';
      holder.textContent = 'Ordenar';
      select = document.createElement('select');
      select.id = 'mobilePurchaseSort';
      select.setAttribute('aria-label', 'Ordenar compras por coluna');
      const initial = document.createElement('option');
      initial.value = '';
      initial.textContent = 'Selecione uma coluna';
      select.append(initial);
      for (const button of headerButtons) {
        const key = button.dataset.purchaseSort;
        const label = button.textContent.replace(/[↕↑↓]/g, '').trim();
        for (const [direction, suffix] of [['asc', '↑'], ['desc', '↓']]) {
          const option = document.createElement('option');
          option.value = key + '|' + direction;
          option.textContent = label + ' ' + suffix;
          select.append(option);
        }
      }
      holder.append(select);
      toolbar.append(holder);
      select.addEventListener('change', () => {
        const [key, direction] = select.value.split('|');
        const button = headerButtons.find(item => item.dataset.purchaseSort === key);
        if (!button) return;
        const expected = direction === 'asc' ? 'ascending' : 'descending';
        for (let tries = 0; tries < 3 && button.closest('th')?.getAttribute('aria-sort') !== expected; tries++) {
          button.click();
        }
        schedule();
      });
    }
    const current = headerButtons.find(button => ['ascending', 'descending'].includes(
      button.closest('th')?.getAttribute('aria-sort')
    ));
    select.value = current
      ? current.dataset.purchaseSort + '|' + (current.closest('th').getAttribute('aria-sort') === 'ascending' ? 'asc' : 'desc')
      : '';
  }

  function decorate() {
    scheduled = false;
    if (!mobile.matches) return;
    for (const table of view.querySelectorAll(TABLE_SELECTOR)) {
      decorateTable(table);
      if (table.classList.contains('data-table')) syncPurchaseSort(table);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

  new MutationObserver(schedule).observe(view, { childList: true, subtree: true });
  mobile.addEventListener?.('change', schedule);
  window.addEventListener('resize', schedule, { passive: true });
  schedule();
})();
