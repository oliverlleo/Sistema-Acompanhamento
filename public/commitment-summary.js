import { getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, ref, onValue, update } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { summaryForMaterials, number } from './material-flow.js?v=20260803-0932';

let materialsByProject = {};
let summariesByProject = {};
let stopMaterials = null;
let stopSummaries = null;
let stopAuth = null;
let reconciling = false;
let reconcileAgain = false;
let started = false;

function relabelProjectCards() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.project-stat span, .progress-meta span, .kpi-top span, .kpi-foot').forEach(label => {
      const text = label.textContent.trim();
      if (text === 'Pendentes' || text === 'Itens pendentes') label.textContent = text === 'Pendentes' ? 'A empenhar' : 'Itens a empenhar';
      if (text === 'Ainda não enviados para a obra') label.textContent = 'Sem origem definida ou compra registrada';
      if (/^\d+\s+pendente\(s\)$/.test(text)) label.textContent = text.replace('pendente(s)', 'a empenhar');
    });
  });
}

async function reconcileSummaries(db) {
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
      const calculated = summaryForMaterials(materialsByProject[projectId] || {});
      const current = summariesByProject[projectId] || {};

      ['pending', 'committed', 'commitmentProgress'].forEach(field => {
        if (number(current[field]) !== number(calculated[field])) {
          changes[`projectSummaries/${projectId}/${field}`] = calculated[field];
        }
      });
    });

    if (Object.keys(changes).length) await update(ref(db), changes);
  } catch (error) {
    console.error('Falha ao atualizar itens a empenhar:', error);
  } finally {
    reconciling = false;
    relabelProjectCards();
    if (reconcileAgain) {
      reconcileAgain = false;
      queueMicrotask(() => reconcileSummaries(db));
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

function start(attempt = 0) {
  if (started) return;
  if (!getApps().length) {
    if (attempt < 20) setTimeout(() => start(attempt + 1), 100);
    return;
  }

  started = true;
  const app = getApp();
  const auth = getAuth(app);
  const db = getDatabase(app);

  stopAuth = onAuthStateChanged(auth, user => {
    stopListeners();
    if (!user) return;

    stopMaterials = onValue(ref(db, 'materials'), snapshot => {
      materialsByProject = snapshot.val() || {};
      reconcileSummaries(db);
    }, error => console.error('Falha ao ler materiais para empenho:', error));

    stopSummaries = onValue(ref(db, 'projectSummaries'), snapshot => {
      summariesByProject = snapshot.val() || {};
      reconcileSummaries(db);
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

window.addEventListener('beforeunload', () => {
  stopListeners();
  stopAuth?.();
});

start();
