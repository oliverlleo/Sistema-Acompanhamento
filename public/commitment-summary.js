import { getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue, update } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const app = getApps().length ? getApp() : null;
const auth = app ? getAuth(app) : null;
const db = app ? getDatabase(app) : null;

let materialsByProject = {};
let summariesByProject = {};
let stopMaterials = null;
let stopSummaries = null;
let reconciling = false;
let reconcileAgain = false;

const COMMITTED_STATUSES = new Set([
  'aguardando_entrega', 'compra_atrasada', 'recebido_parcial',
  'aguarda_pintura', 'em_pintura', 'pintura_atrasada',
  'pronto_separar', 'separado_parcial', 'separado',
  'enviado_parcial', 'enviado_obra'
]);

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value ?? '').trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCommitted(material = {}) {
  if (material.source === 'estoque') return true;
  if (material.source !== 'compra') return false;

  if (material.purchaseDate || material.orderNumber) return true;
  if (COMMITTED_STATUSES.has(material.status)) return true;

  return [
    material.qtyReceived,
    material.paintingSentQty,
    material.paintingReturnedQty,
    material.separatedQty,
    material.siteDeliveredQty
  ].some(value => number(value) > 0);
}

function commitmentCounts(materials = {}) {
  const list = Object.values(materials || {});
  const committed = list.filter(isCommitted).length;
  const total = list.length;
  return {
    total,
    committed,
    pending: Math.max(0, total - committed),
    commitmentProgress: total ? Math.round((committed / total) * 100) : 0
  };
}

function relabelProjectCards() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.project-stat span').forEach(label => {
      if (label.textContent.trim() === 'Pendentes') label.textContent = 'A empenhar';
    });
  });
}

async function reconcileSummaries() {
  if (!db) return;
  if (reconciling) {
    reconcileAgain = true;
    return;
  }

  reconciling = true;
  try {
    const projectIds = new Set([
      ...Object.keys(materialsByProject || {}),
      ...Object.keys(summariesByProject || {})
    ]);
    const changes = {};

    projectIds.forEach(projectId => {
      const counts = commitmentCounts(materialsByProject[projectId]);
      const current = summariesByProject[projectId] || {};

      if (number(current.pending) !== counts.pending) {
        changes[`projectSummaries/${projectId}/pending`] = counts.pending;
      }
      if (number(current.committed) !== counts.committed) {
        changes[`projectSummaries/${projectId}/committed`] = counts.committed;
      }
      if (number(current.commitmentProgress) !== counts.commitmentProgress) {
        changes[`projectSummaries/${projectId}/commitmentProgress`] = counts.commitmentProgress;
      }
    });

    if (Object.keys(changes).length) await update(ref(db), changes);
  } catch (error) {
    console.error('Falha ao atualizar itens a empenhar:', error);
  } finally {
    reconciling = false;
    relabelProjectCards();
    if (reconcileAgain) {
      reconcileAgain = false;
      queueMicrotask(reconcileSummaries);
    }
  }
}

function stopListeners() {
  stopMaterials?.();
  stopSummaries?.();
  stopMaterials = null;
  stopSummaries = null;
  materialsByProject = {};
  summariesByProject = {};
}

if (auth && db) {
  onAuthStateChanged(auth, user => {
    stopListeners();
    if (!user) return;

    stopMaterials = onValue(ref(db, 'materials'), snapshot => {
      materialsByProject = snapshot.val() || {};
      reconcileSummaries();
    }, error => console.error('Falha ao ler materiais para empenho:', error));

    stopSummaries = onValue(ref(db, 'projectSummaries'), snapshot => {
      summariesByProject = snapshot.val() || {};
      reconcileSummaries();
      relabelProjectCards();
    }, error => console.error('Falha ao ler resumos das obras:', error));
  });
}

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-route="dashboard"], [data-route="obras"]')) {
    setTimeout(relabelProjectCards, 80);
    setTimeout(relabelProjectCards, 300);
  }
});
