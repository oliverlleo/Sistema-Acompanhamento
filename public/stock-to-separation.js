import { getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get, update } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const app = getApps().length ? getApp() : null;
const db = app ? getDatabase(app) : null;
let running = false;

function number(value) {
  const parsed = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function currentProjectId() {
  return document.querySelector('#globalProjectSelect')?.value
    || localStorage.getItem('obraflow.currentProject')
    || '';
}

function correctStockStatus(material) {
  const required = Math.max(0, number(material.qtyRequired));
  const delivered = number(material.siteDeliveredQty);
  const separated = number(material.separatedQty);

  if (required > 0 && delivered >= required) return 'enviado_obra';
  if (delivered > 0) return 'enviado_parcial';
  if (required > 0 && separated >= required) return 'separado';
  if (separated > 0) return 'separado_parcial';
  return 'pronto_separar';
}

async function migrateStockItems() {
  if (!db || running) return;
  const projectId = currentProjectId();
  if (!projectId) return;

  running = true;
  try {
    const snapshot = await get(ref(db, `materials/${projectId}`));
    const materials = snapshot.val() || {};
    const changes = {};

    Object.entries(materials).forEach(([id, material]) => {
      if (material?.source !== 'estoque') return;
      const status = correctStockStatus(material);
      if (material.status !== status) {
        changes[`materials/${projectId}/${id}/status`] = status;
        changes[`materials/${projectId}/${id}/updatedAt`] = Date.now();
      }
    });

    if (Object.keys(changes).length) await update(ref(db), changes);
  } catch (error) {
    console.error('Falha ao mover itens de estoque para separação:', error);
  } finally {
    running = false;
  }
}

document.addEventListener('change', event => {
  if (event.target.matches?.('#globalProjectSelect')) setTimeout(migrateStockItems, 80);
});

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="materiais"], [data-route="separacao"]')) {
    setTimeout(migrateStockItems, 120);
  }
});

setTimeout(migrateStockItems, 250);
