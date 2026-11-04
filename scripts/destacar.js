// Gazua da Mesa — janelas desacopladas.
// Quando o usuário usa "Desacoplar janela" (Foundry 14), a janela vai para outra janela do navegador.
// Este vigia percebe a mudança e marca a janela com a classe "lp-destacada"; o CSS então faz o
// conteúdo ocupar a janela inteira e acompanhar o tamanho dela. Ao reacoplar, a classe sai.

const CLASSE = "lp-destacada";
const vigiados = new WeakSet();

/** Marca ou desmarca a janela conforme o documento em que ela está agora. */
function conferir(el) {
  if (!el?.isConnected) return;
  const fora = el.ownerDocument !== document;
  if (el.classList.contains(CLASSE) !== fora) el.classList.toggle(CLASSE, fora);
}

/** Confere já e mais duas vezes logo depois (a mudança de janela não é instantânea). */
function conferirLogo(el) {
  conferir(el);
  setTimeout(() => conferir(el), 60);
  setTimeout(() => conferir(el), 400);
}

/** Começa a vigiar a janela de uma aplicação do módulo. */
export function vigiarJanela(el) {
  if (!el || vigiados.has(el)) return conferir(el);
  vigiados.add(el);
  // o Foundry mexe no estilo/classe da janela ao desacoplar e reacoplar
  new MutationObserver(() => conferirLogo(el)).observe(el, { attributes: true, attributeFilter: ["style", "class"] });
  conferirLogo(el);
}

// a janela sai do documento principal ao desacoplar e volta ao reacoplar
let observadorCorpo = null;
function vigiarCorpo() {
  if (observadorCorpo || !document.body) return;
  observadorCorpo = new MutationObserver(registros => {
    for (const r of registros) {
      for (const no of [...r.addedNodes, ...r.removedNodes]) {
        if (no instanceof HTMLElement && no.classList.contains("gazua-mesa")) conferirLogo(no);
      }
    }
  });
  observadorCorpo.observe(document.body, { childList: true });
}

Hooks.on("renderApplicationV2", app => {
  const el = app?.element;
  if (!el?.classList?.contains("gazua-mesa")) return;
  vigiarCorpo();
  vigiarJanela(el);
});
