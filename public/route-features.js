import './commitment-summary.js?v=20260803-0959';
import './search-caret-fix.js?v=20260803-1025';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const loaded = {
  importar: false,
  compras: false,
  medidas: false
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

async function loadRouteFeature() {
  const route = currentRoute();

  if (route === 'importar') {
    if (!loaded.importar) {
      loaded.importar = true;
      try {
        await import('./xlsx-import-fix.js?v=20260803-0932');
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

  if (route === 'compras' && !loaded.compras) {
    loaded.compras = true;
    try {
      await import('./bulk-purchase.js?v=20260803-0932');
    } catch (error) {
      loaded.compras = false;
      console.error('Falha ao carregar compra em lote:', error);
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
