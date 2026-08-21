import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, get, onValue, ref } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDtfxhvronefOV9MoDj-GvUUiJ3TLfb8qc',
  authDomain: 'sistemsquared.firebaseapp.com',
  databaseURL: 'https://sistemsquared-default-rtdb.firebaseio.com',
  projectId: 'sistemsquared',
  storageBucket: 'sistemsquared.firebasestorage.app',
  messagingSenderId: '43452051582',
  appId: '1:43452051582:web:08a19296448eb66d0b282f'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// A proteção nunca relê /materials inteiro. Com muitas obras isso seria caro.
// Ela confere apenas estruturas leves, a obra ativa e poucas rotas usadas
// recentemente pelas telas internas.
const LIGHT_PATHS = ['projects', 'projectSummaries'];
const RETRY_DELAYS = [0, 400, 1200, 3000, 7000];
const MIN_CONTEXT_RECHECK_MS = 60_000;
const WATCHED_PATH_TTL_MS = 10 * 60_000;
const MAX_WATCHED_PATHS = 4;

let currentUser = null;
let verificationInFlight = null;
let lastVerifiedAt = 0;
let stopConnectionListener = null;
let delayedChecks = [];
const watchedPaths = new Map();

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

function currentProjectId() {
  return localStorage.getItem('obraflow.currentProject') || '';
}

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

function rememberPath(path) {
  if (!/^materials\/[^/]+$/.test(path) && !/^activities\/[^/]+$/.test(path)) return;
  watchedPaths.delete(path);
  watchedPaths.set(path, Date.now());

  while (watchedPaths.size > MAX_WATCHED_PATHS) {
    const oldest = watchedPaths.keys().next().value;
    watchedPaths.delete(oldest);
  }
}

function recentWatchedPaths() {
  const cutoff = Date.now() - WATCHED_PATH_TTL_MS;
  const paths = [];

  for (const [path, usedAt] of watchedPaths.entries()) {
    if (usedAt < cutoff) {
      watchedPaths.delete(path);
      continue;
    }
    paths.push(path);
  }

  return paths;
}

function contextPaths() {
  const paths = [...LIGHT_PATHS, ...recentWatchedPaths()];
  const projectId = currentProjectId();

  if (projectId) {
    paths.push(`materials/${projectId}`);
    if (currentRoute() === 'materiais') paths.push(`activities/${projectId}`);
  }

  if (currentRoute() === 'usuarios') paths.push('users');
  return [...new Set(paths)];
}

async function readPathWithRetry(path, reason, { remember = true } = {}) {
  if (remember) rememberPath(path);
  let lastError = null;

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt += 1) {
    const delay = RETRY_DELAYS[attempt];
    if (delay) await sleep(delay);
    if (!currentUser) throw new Error('Sessão encerrada durante a sincronização.');

    try {
      const snapshot = await get(ref(db, path));
      const value = snapshot.val() || {};
      notify('obraflow:backend-path-synced', { path, reason, value });
      return value;
    } catch (error) {
      lastError = error;
      console.warn(
        `Falha ao conferir ${path} no Firebase (tentativa ${attempt + 1}/${RETRY_DELAYS.length}):`,
        error
      );
    }
  }

  throw lastError || new Error(`Não foi possível conferir ${path}.`);
}

async function verifyContext(reason = 'automatic', { force = false } = {}) {
  if (!currentUser) return false;
  if (!force && Date.now() - lastVerifiedAt < MIN_CONTEXT_RECHECK_MS) return true;
  if (verificationInFlight) return verificationInFlight;

  verificationInFlight = (async () => {
    const paths = contextPaths();
    const results = await Promise.allSettled(
      paths.map(async path => [
        path,
        await readPathWithRetry(path, reason, { remember: false })
      ])
    );

    const failures = results.filter(result => result.status === 'rejected');
    const snapshot = {};

    results.forEach(result => {
      if (result.status === 'fulfilled') snapshot[result.value[0]] = result.value[1];
    });

    if (failures.length) {
      const error = failures[0].reason;
      console.error('A conferência automática do backend não terminou por completo:', error);
      notify('obraflow:backend-sync-failed', {
        reason,
        failedPaths: failures.length,
        error: error?.message || String(error || '')
      });
      return false;
    }

    lastVerifiedAt = Date.now();
    window.ObraFlowBackendSnapshot = {
      paths: snapshot,
      verifiedAt: lastVerifiedAt,
      reason
    };
    notify('obraflow:backend-synced', {
      reason,
      verifiedAt: lastVerifiedAt,
      paths: Object.keys(snapshot)
    });
    return true;
  })().finally(() => {
    verificationInFlight = null;
  });

  return verificationInFlight;
}

function scheduleStartupChecks() {
  clearDelayedChecks();

  // A primeira confere após autenticar; a segunda pega módulos/listeners que
  // terminaram de montar um pouco depois. Não existe polling contínuo.
  delayedChecks.push(setTimeout(() => verifyContext('startup', { force: true }), 350));
  delayedChecks.push(setTimeout(() => verifyContext('startup-settled', { force: true }), 2200));
}

function startConnectionWatch() {
  stopConnectionListener?.();
  stopConnectionListener = onValue(ref(db, '.info/connected'), snapshot => {
    const connected = snapshot.val() === true;
    document.documentElement.dataset.backendConnected = connected ? 'true' : 'false';
    notify('obraflow:backend-connection', { connected });

    // Usa o estado real do RTDB, não apenas navigator.onLine.
    if (connected && currentUser) {
      verifyContext('firebase-reconnected', { force: true });
    }
  }, error => {
    console.warn('Não foi possível acompanhar o estado da conexão com o Firebase:', error);
  });
}

onAuthStateChanged(auth, user => {
  currentUser = user;
  clearDelayedChecks();

  if (!user) {
    lastVerifiedAt = 0;
    watchedPaths.clear();
    window.ObraFlowBackendSnapshot = null;
    stopConnectionListener?.();
    stopConnectionListener = null;
    return;
  }

  startConnectionWatch();
  scheduleStartupChecks();
});

window.addEventListener('online', () => {
  if (currentUser) verifyContext('browser-online', { force: true });
});

window.addEventListener('focus', () => {
  if (currentUser) verifyContext('window-focus');
});

window.addEventListener('hashchange', () => {
  if (currentUser) verifyContext('route-change', { force: true });
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser) verifyContext('tab-visible');
});

window.ObraFlowBackendGuard = {
  verify: (reason = 'manual') => verifyContext(reason, { force: true }),
  read: (path, reason = 'manual-read') => readPathWithRetry(path, reason),
  get lastVerifiedAt() {
    return lastVerifiedAt;
  }
};
