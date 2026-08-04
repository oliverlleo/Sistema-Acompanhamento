import './commitment-summary.js?v=20260803-0959';
import './search-caret-fix.js?v=20260803-1025';
import './direct-paint-delivery.js?v=20260803-1648';
import './acompanhamento-detail.js?v=20260803-1648';
import './tracking-item-counts.js?v=20260803-1648';
import './tracking-available-summary.js?v=20260804-1625';
import './tracking-card-stock-count.js?v=20260803-1633';
import './tracking-unresolved-stage.js?v=20260803-1933';
import './tracking-card-availability.js?v=20260804-1625';
import './tracking-category-progress.js?v=20260804-1625';
import './tracking-available-name.js?v=20260803-2208';
import './materials-origin-status.js?v=20260803-1943';
import './purchase-needs-action-filter.js?v=20260803-1958';
import './global-receiving.js?v=20260803-2013';
import './global-receiving-color.js?v=20260803-2030';
import './user-role-permissions.js?v=20260803-2149';
import './calendar.js?v=20260803-1950';
import './calendar-focus-fix.js?v=20260803-1951';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const loaded = {
  importar: false,
  compras: false,
  excelCompras: false,
  medidas: false,
  separados: false
};

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function addPendingOption(select) {
  if (!select || select.querySelector('option[value="pendente"]')) return;
  const option = document.createElement('option');
  option.value = 'pendente';
  option.textContent = 'Definir depois';
  select.insertBefore(option, select.firstChild);
}

function prepareImportChoices() {
  if (currentRoute() !== 'importar') return;

  const globalSource = $('#importSource');
  if (globalSource) {
    addPendingOption(globalSource);
    if (!globalSource.dataset.pendingDefaultApplied) {
      globalSource.dataset.pendingDefaultApplied = '1';
      globalSource.value = 'pendente';
      globalSource.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  $$('[data-xlsx-source]').forEach(select => {
    addPendingOption(select);
    if (globalSource?.value === 'pendente' && select.value !== 'pendente') {
      select.value = 'pendente';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

function scheduleImportPreparation() {
  [0, 120, 350, 800, 1500].forEach(delay => setTimeout(prepareImportChoices, delay));
}

async function loadMeasuresFeature() {
  if (loaded.medidas) return;
  loaded.medidas = true;
  try {
    await import('./queue-measures.js?v=20260803-0932');
  } catch (error) {
    loaded.medidas = false;
    console.error('Falha ao carregar medidas das filas:', error);
  }
}

async function loadPurchaseExcelFeature() {
  if (loaded.excelCompras) return;
  loaded.excelCompras = true;
  try {
    await import('./purchase-excel-export.js?v=20260803-2005');
  } catch (error) {
    loaded.excelCompras = false;
    console.error('Falha ao carregar exportação da lista de compra:', error);
  }
}

async function loadSeparatedProjectsFeature() {
  if (loaded.separados) {
    window.ObraFlowSeparatedProjects?.render?.();
    return;
  }
  loaded.separados = true;
  try {
    await import('./separated-projects.js?v=20260803-1648');
    window.ObraFlowSeparatedProjects?.render?.();
  } catch (error) {
    loaded.separados = false;
    console.error('Falha ao carregar materiais separados por obra:', error);
  }
}

async function loadRouteFeature() {
  const route = currentRoute();

  if (route === 'estoque') {
    await loadSeparatedProjectsFeature();
    return;
  }

  if (route === 'importar') {
    if (!loaded.importar) {
      loaded.importar = true;
      try {
        await import('./xlsx-import-fix.js?v=20260803-1648');
      } catch (error) {
        loaded.importar = false;
        console.error('Falha ao carregar importador XLSX:', error);
      }
    }
    scheduleImportPreparation();
    return;
  }

  if (route === 'compras' || route === 'recebimento') {
    await loadMeasuresFeature();
  }

  if (route === 'compras') {
    await loadPurchaseExcelFeature();

    if (!loaded.compras) {
      loaded.compras = true;
      try {
        await import('./bulk-purchase.js?v=20260803-0932');
      } catch (error) {
        loaded.compras = false;
        console.error('Falha ao carregar compra em lote:', error);
      }
    }
  }
}

document.addEventListener('change', event => {
  if (currentRoute() === 'importar' && event.target.matches?.('#importFile')) {
    scheduleImportPreparation();
  }
});

document.addEventListener('click', event => {
  const routeButton = event.target.closest?.('[data-route]');
  if (!routeButton) return;
  setTimeout(loadRouteFeature, 60);
  setTimeout(loadRouteFeature, 280);
});

window.addEventListener('hashchange', loadRouteFeature);
loadRouteFeature();