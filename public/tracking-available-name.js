function currentRoute() {
  return location.hash.replace(/^#/, '') || 'dashboard';
}

let patchQueued = false;

function replaceText(element, from, to) {
  if (!element) return;
  const current = element.textContent || '';
  if (current.includes(from)) element.textContent = current.replaceAll(from, to);
}

function patchAvailableName() {
  patchQueued = false;
  if (currentRoute() !== 'estoque') return;

  const stage = document.querySelector('[data-tracking-stage="disponivel"]');
  const stageLabel = stage?.querySelector('.trk-stage-copy strong');
  if (stageLabel && stageLabel.textContent !== 'Disponível') stageLabel.textContent = 'Disponível';

  if (stage) {
    const subtitle = document.querySelector('#pageSubtitle');
    if (subtitle && subtitle.textContent !== 'Compras, pintura, disponibilidade e separação por obra') {
      subtitle.textContent = 'Compras, pintura, disponibilidade e separação por obra';
    }
  }

  const availableActive = stage?.classList.contains('active');
  if (!availableActive) return;

  const panelTitle = document.querySelector('.trk-panel-head h3');
  if (panelTitle && panelTitle.textContent !== 'Materiais disponíveis') {
    panelTitle.textContent = 'Materiais disponíveis';
  }

  const progressTitle = document.querySelector('.trk-progress-head span');
  if (progressTitle && progressTitle.textContent !== 'Disponível') {
    progressTitle.textContent = 'Disponível';
  }

  document.querySelectorAll('[data-tracking-category-progress] .trk-category small').forEach(element => {
    replaceText(element, 'conferidos', 'disponíveis');
    replaceText(element, 'conferido', 'disponível');
  });

  document.querySelectorAll('.trk-summary .trk-metric span').forEach(element => {
    replaceText(element, 'Quantidade conferida e ainda não separada', 'Quantidade disponível e ainda não separada');
  });
}

function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(() => setTimeout(patchAvailableName, 0));
}

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-separated-project], [data-tracking-stage], [data-route="estoque"]')) {
    setTimeout(queuePatch, 0);
    setTimeout(queuePatch, 120);
  }
}, true);

window.addEventListener('hashchange', queuePatch);

const view = document.querySelector('#view');
if (view) new MutationObserver(queuePatch).observe(view, { childList: true, subtree: true });

queuePatch();
