let deferredInstallPrompt = null;
const DISMISS_KEY = 'obraflow-install-dismissed-at';
const DISMISS_DAYS = 7;
const PWA_VERSION = '20260804-0718';

const userAgent = navigator.userAgent || '';
const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const isMobileDevice = navigator.userAgentData?.mobile === true
  || /android|iphone|ipad|ipod|iemobile|opera mini/i.test(userAgent)
  || isIPadOS;
const isIOS = /iphone|ipad|ipod/i.test(userAgent) || isIPadOS;
const isSafariIOS = isIOS
  && /safari/i.test(userAgent)
  && !/crios|fxios|edgios/i.test(userAgent);

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function recentlyDismissed() {
  try {
    const saved = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return saved > 0 && Date.now() - saved < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // O aviso continuará funcionando mesmo com armazenamento bloqueado.
  }
}

function ensureManifest() {
  if (!isMobileDevice || document.querySelector('link[rel="manifest"]')) return;
  const manifest = document.createElement('link');
  manifest.rel = 'manifest';
  manifest.href = `./manifest.webmanifest?v=${PWA_VERSION}`;
  document.head.appendChild(manifest);
}

function ensureStyle() {
  if (document.querySelector('#pwaInstallStyle')) return;
  const style = document.createElement('style');
  style.id = 'pwaInstallStyle';
  style.textContent = `
    .pwa-install-banner{position:fixed;z-index:10000;left:50%;bottom:max(18px,env(safe-area-inset-bottom));display:flex;align-items:center;gap:13px;width:min(520px,calc(100% - 28px));padding:14px 15px;border:1px solid rgba(15,118,110,.22);border-radius:18px;background:#fff;box-shadow:0 18px 48px rgba(15,23,42,.2);transform:translateX(-50%);color:#0f172a}
    .pwa-install-icon{display:grid;place-items:center;flex:0 0 48px;width:48px;height:48px;border-radius:14px;overflow:hidden;background:#0f766e}
    .pwa-install-icon img{display:block;width:100%;height:100%;object-fit:cover}
    .pwa-install-copy{min-width:0;flex:1}.pwa-install-copy strong{display:block;font-size:13px}.pwa-install-copy span{display:block;margin-top:4px;color:#64748b;font-size:11px;line-height:1.4}
    .pwa-install-actions{display:flex;align-items:center;gap:7px}.pwa-install-actions button{min-height:36px;padding:0 11px;border-radius:10px;border:1px solid #d8e0e8;background:#fff;color:#334155;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.pwa-install-actions .pwa-install-primary{border-color:#0f766e;background:#0f766e;color:#fff}
    @media(max-width:560px){.pwa-install-banner{align-items:flex-start;flex-wrap:wrap}.pwa-install-copy{padding-right:4px}.pwa-install-actions{width:100%;justify-content:flex-end;padding-left:61px}}
  `;
  document.head.appendChild(style);
}

function closeBanner(remember = false) {
  document.querySelector('[data-pwa-install-banner]')?.remove();
  if (remember) rememberDismissal();
}

function showBanner({ ios = false } = {}) {
  if (!isMobileDevice || isInstalled() || recentlyDismissed() || document.querySelector('[data-pwa-install-banner]')) return;
  ensureStyle();

  const banner = document.createElement('aside');
  banner.className = 'pwa-install-banner';
  banner.dataset.pwaInstallBanner = 'true';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Instalar ObraFlow');
  banner.innerHTML = `
    <div class="pwa-install-icon"><img src="./icon-192.svg?v=20260803-2255" alt="" /></div>
    <div class="pwa-install-copy">
      <strong>Adicionar ObraFlow à tela inicial</strong>
      <span>${ios
        ? 'No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.'
        : 'Abra o sistema como aplicativo, com ícone próprio e acesso rápido.'}</span>
    </div>
    <div class="pwa-install-actions">
      <button type="button" data-pwa-dismiss>Agora não</button>
      ${ios ? '<button type="button" class="pwa-install-primary" data-pwa-understood>Entendi</button>' : '<button type="button" class="pwa-install-primary" data-pwa-install>Instalar</button>'}
    </div>`;

  banner.querySelector('[data-pwa-dismiss]')?.addEventListener('click', () => closeBanner(true));
  banner.querySelector('[data-pwa-understood]')?.addEventListener('click', () => closeBanner(true));
  banner.querySelector('[data-pwa-install]')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    closeBanner(choice?.outcome !== 'accepted');
  });

  document.body.appendChild(banner);
}

async function registerServiceWorker() {
  if (!isMobileDevice || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js', {
      scope: './',
      updateViaCache: 'none'
    });
  } catch (error) {
    console.error('Falha ao registrar o aplicativo instalável:', error);
  }
}

async function disableDesktopPwa() {
  deferredInstallPrompt = null;
  closeBanner(false);
  document.querySelectorAll('link[rel="manifest"]').forEach(link => link.remove());

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => {
        const worker = registration.active || registration.waiting || registration.installing;
        const scriptUrl = worker?.scriptURL || '';
        return scriptUrl.endsWith('/sw.js') ? registration.unregister() : Promise.resolve(false);
      }));
    } catch (error) {
      console.error('Falha ao remover o PWA da versão desktop:', error);
    }
  }

  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames
        .filter(name => name.startsWith('obraflow-'))
        .map(name => caches.delete(name)));
    } catch {
      // O desktop continua funcionando normalmente sem limpar o cache.
    }
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  if (!isMobileDevice) {
    deferredInstallPrompt = null;
    return;
  }
  deferredInstallPrompt = event;
  setTimeout(() => showBanner(), 600);
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  closeBanner(false);
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    // Nada a fazer.
  }
});

if (isMobileDevice) {
  ensureManifest();
  registerServiceWorker();
  if (isSafariIOS && !isInstalled()) setTimeout(() => showBanner({ ios: true }), 1600);
} else {
  disableDesktopPwa();
}
