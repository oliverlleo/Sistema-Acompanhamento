const STYLE_ID = 'topbarNotificationPositionStyle';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .topbar-actions #obraflowNotificationBell {
      order: 99 !important;
    }

    @media (max-width: 760px) {
      .topbar-actions {
        flex: 0 0 auto !important;
        flex-basis: auto !important;
        width: auto !important;
        min-width: 42px !important;
        max-width: none !important;
        margin-left: auto !important;
        justify-content: flex-end !important;
      }

      .topbar-actions #obraflowNotificationBell {
        order: 99 !important;
        margin-left: auto !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function positionNotificationButton() {
  ensureStyle();

  const actions = document.querySelector('.topbar-actions');
  const bell = document.querySelector('#obraflowNotificationBell');
  if (!actions || !bell) return;

  // O seletor permanece como já está no mobile. Apenas o sino fica no extremo direito.
  if (actions.lastElementChild !== bell) actions.appendChild(bell);
}

positionNotificationButton();

document.addEventListener('DOMContentLoaded', positionNotificationButton, { once: true });

const observer = new MutationObserver(positionNotificationButton);
observer.observe(document.documentElement, { childList: true, subtree: true });
