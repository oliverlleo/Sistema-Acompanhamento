const OLD_LABEL = 'Separado para obra';
const NEW_LABEL = 'Separado produção';

function replaceLabel(root = document.body) {
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    if (node.nodeValue?.includes(OLD_LABEL)) {
      node.nodeValue = node.nodeValue.replaceAll(OLD_LABEL, NEW_LABEL);
    }
    node = walker.nextNode();
  }
}

const observer = new MutationObserver(mutations => {
  mutations.forEach(mutation => {
    if (mutation.type === 'characterData') {
      const node = mutation.target;
      if (node.nodeValue?.includes(OLD_LABEL)) {
        node.nodeValue = node.nodeValue.replaceAll(OLD_LABEL, NEW_LABEL);
      }
      return;
    }

    mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue?.includes(OLD_LABEL)) {
          node.nodeValue = node.nodeValue.replaceAll(OLD_LABEL, NEW_LABEL);
        }
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE) replaceLabel(node);
    });
  });
});

function start() {
  replaceLabel();
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
