import { getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, get, onValue, ref } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const app = getApps().length ? getApp() : null;
if (!app) throw new Error('Firebase ainda não foi inicializado.');

const auth = getAuth(app);
const db = getDatabase(app);

const CRITICAL_PATHS = ['projects', 'materials'];
const AUXILIARY_PATHS = ['projectSummaries', 'inventory'];
const RETRY_DELAYS = [0, 350, 1000, 2500];
const MIN_RECHECK_MS = 45_000;

let currentUser = null;
let verificationInFlight = null;
let lastVerifiedAt = 0;
let stopConnectionListener = null;
let delayedChecks = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clearDelayedChecks() {
  delayedChecks.forEach(timer => clearTimeout(timer));
  delayedChecks = [];
}

function notify(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function readPath(path) {
  const snapshot = await get(ref(db, path));
  return snapshot.val() || {};
}

async function verifyOnce(reason) {
  const criticalResults = await Promise.all(
    CRITICAL_PATHS.map(async path => [path, await readPath(path)])
  );

  // As leituras acima atualizam o cache local do mesmo Firebase usado pelos
  // listeners das telas. Assim, qualquer listener que tenha recebido uma
  // fotografia antiga recebe os dados atuais sem exigir F5.
  const auxiliaryResults = await Promise.allSettled(
    AUXILIARY_PATHS.map(async path => [path, await readPath(path)])
  );

  const snapshot = Object.fromEntries(criticalResults);
  auxiliaryResults.forEach(result => {
    if (result.status === 'fulfilled') snapshot[result.value[0]] = result.value[1];
  });

  lastVerifiedAt = Date.now();
  window.ObraFlowBackendSnapshot = {
    ...snapshot,
    verifiedAt: lastVerifiedAt,
    reason
  };
  notify('obraflow:backend-synced', { reason, verifiedAt: lastVerifiedAt });
  return snapshot;
}

async function verifyBackend(reason = 'automatic', { force = false } = {}) {
  if (!currentUser) return false;
  if (!force && Date.now() - lastVerifiedAt < MIN_RECHECK_MS) return true;
  if (verificationInFlight) return verificationInFlight;

  verificationInFlight = (async () => {
    let lastError = null;

    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt += 1) {
      const delay = RETRY_DELAYS[attempt];
      if (delay) await sleep(delay);
      if (!currentUser) return false;

      try {
        await verifyOnce(reason);
        return true;
      } catch (error) {
        lastError = error;
        console.warn(`Falha na conferência do backend (tentativa ${attempt + 1}/${RETRY_DELAYS.length}):`, error);
      }
    }

    console.error('Não foi possível confirmar os dados do Firebase após novas tentativas:', lastError);
    notify('obraflow:backend-sync-failed', { reason, error: lastError?.message || String(lastError || '') });
    return false;
  })().finally(() => {
    verificationInFlight = null;
  });

  return verificationInFlight;
}

function scheduleStartupChecks() {
  clearDelayedChecks();
  // Uma conferência logo após o login e outra depois que todos os módulos e
  // listeners tiveram tempo de iniciar evita aceitar uma primeira leitura
  // incompleta ou antiga como estado definitivo da tela.
  delayedChecks.push(setTimeout(() => verifyBackend('startup', { force: true }), 300));
  delayedChecks.push(setTimeout(() => verifyBackend('startup-settled', { force: true }), 1800));
}

function startConnectionWatch() {
  stopConnectionListener?.();
  stopConnectionListener = onValue(ref(db, '.info/connected'), snapshot => {
    const connected = snapshot.val() === true;
    document.documentElement.dataset.backendConnected = connected ? 'true' : 'false';
    if (connected && currentUser) verifyBackend('firebase-reconnected', { force: true });
  }, error => {
    console.warn('Não foi possível acompanhar o estado da conexão com o Firebase:', error);
  });
}

onAuthStateChanged(auth, user => {
  currentUser = user;
  clearDelayedChecks();

  if (!user) {
    lastVerifiedAt = 0;
    window.ObraFlowBackendSnapshot = null;
    stopConnectionListener?.();
    stopConnectionListener = null;
    return;
  }

  startConnectionWatch();
  scheduleStartupChecks();
});

window.addEventListener('online', () => {
  if (currentUser) verifyBackend('browser-online', { force: true });
});

window.addEventListener('focus', () => {
  if (currentUser) verifyBackend('window-focus');
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser) verifyBackend('tab-visible');
});

// Permite que qualquer tela peça uma conferência sem recarregar a página.
window.ObraFlowBackendGuard = {
  verify: (reason = 'manual') => verifyBackend(reason, { force: true }),
  get lastVerifiedAt() {
    return lastVerifiedAt;
  }
};
