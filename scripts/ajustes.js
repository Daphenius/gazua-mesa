// Gazua da Mesa — configuração individual de cada minijogo (Configurações do módulo → Configurar minijogos).

import { ID, t } from "./dados.js";

const { ApplicationV2 } = foundry.applications.api;

export const LISTA = ["discos", "runas", "labirinto", "sigilo", "cristais", "canalizar"];

const ICONES = {
  discos: "fa-circle-notch", runas: "fa-hat-wizard", labirinto: "fa-bolt",
  sigilo: "fa-pen-nib", cristais: "fa-gem", canalizar: "fa-wand-magic-sparkles"
};

// Comum a todos: ativo (entra no sorteio da Surpresa), tempo próprio (0 = o da fechadura),
// ajuste de dificuldade (-3 a +3) e concentração extra.
const COMUM = { ativo: true, tempo: 0, ajuste: 0, concentracao: 0 };

// Opções de cada jogo: [chave, tipo, padrão, mínimo, máximo, passo]
export const OPCOES = {
  discos: [["maxAneis", "number", 5, 2, 5, 1], ["ligacoes", "bool", true]],
  runas: [["inverterDesde", "number", 7, 0, 10, 1], ["ritmo", "number", 1, 0.5, 2, 0.1]],
  labirinto: [["maxTamanho", "number", 10, 5, 10, 1], ["mostrarRastro", "bool", true]],
  sigilo: [["maxRunas", "number", 10, 5, 10, 1], ["dicaImpar", "bool", false]],
  cristais: [["maxGrade", "number", 5, 3, 5, 1]],
  canalizar: [["velocidade", "number", 1, 0.5, 2, 0.1], ["largura", "number", 1, 0.5, 2, 0.1]]
};

const TEM_CONCENTRACAO = ["runas", "labirinto", "sigilo"];

export function padrao(tipo) {
  const o = { ...COMUM };
  for (const [k, , v] of OPCOES[tipo] ?? []) o[k] = v;
  return o;
}

/** Ajustes de um minijogo, já com os padrões preenchidos. */
export function lerAjustes(tipo) {
  let salvo = {};
  try { salvo = game.settings.get(ID, "minijogos")?.[tipo] ?? {}; } catch { /* antes do registro */ }
  return { ...padrao(tipo), ...salvo };
}

export function jogosAtivos() {
  const ativos = LISTA.filter(j => lerAjustes(j).ativo);
  return ativos.length ? ativos : LISTA;
}

// ---------- Janela ----------

export class JanelaMinijogos extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "gazua-mesa-minijogos",
    tag: "form",
    classes: ["gazua-mesa", "lp-dialogo", "lp-ajustes"],
    window: { title: "GAZUAMESA.Ajustes.Titulo", icon: "fa-solid fa-puzzle-piece", resizable: true },
    position: { width: 640, height: 720 },
    form: { handler: JanelaMinijogos.#salvar, closeOnSubmit: true },
    actions: { testar: JanelaMinijogos.#testar, padrao: JanelaMinijogos.#padrao }
  };

  async _renderHTML() {
    const campo = (tipo, chave, tipoCampo, valor, min, max, passo) => {
      const nome = `${tipo}.${chave}`;
      const rotulo = t(`Ajustes.Campo.${chave}`);
      const dica = t(`Ajustes.Dica.${chave}`);
      if (tipoCampo === "bool") {
        return `<label class="lp-interruptor"><span class="lp-txt"><b>${rotulo}</b><small>${dica}</small></span>
          <input type="checkbox" name="${nome}" ${valor ? "checked" : ""}><span class="lp-trilho"></span></label>`;
      }
      return `<div class="lp-linha"><label>${rotulo}</label><div class="lp-campo">
          <input type="number" name="${nome}" value="${valor}" min="${min}" max="${max}" step="${passo}"></div>
          <p class="lp-dica">${dica}</p></div>`;
    };

    const cartoes = LISTA.map(tipo => {
      const a = lerAjustes(tipo);
      const comuns = [
        campo(tipo, "ativo", "bool", a.ativo),
        campo(tipo, "tempo", "number", a.tempo, 0, 600, 5),
        campo(tipo, "ajuste", "number", a.ajuste, -3, 3, 1),
        TEM_CONCENTRACAO.includes(tipo) ? campo(tipo, "concentracao", "number", a.concentracao, -2, 5, 1) : ""
      ].join("");
      const proprios = (OPCOES[tipo] ?? []).map(([k, tp, , mn, mx, ps]) => campo(tipo, k, tp, a[k], mn, mx, ps)).join("");
      return `
        <details class="lp-secao lp-ajuste-jogo" data-tipo="${tipo}">
          <summary>
            <i class="fa-solid ${ICONES[tipo]}"></i> ${t(`Jogo.${tipo}.Nome`)}
            <span class="lp-estado-jogo ${a.ativo ? "on" : ""}">${t(a.ativo ? "Ajustes.NoSorteio" : "Ajustes.ForaSorteio")}</span>
          </summary>
          <p class="lp-dica">${t(`Jogo.${tipo}.Resumo`)}</p>
          ${comuns}
          <h4>${t("Ajustes.Proprias")}</h4>
          ${proprios}
          <div class="lp-botoes">
            <button type="button" data-action="testar" data-tipo="${tipo}"><i class="fa-solid fa-play"></i> ${t("Ajustes.Testar")}</button>
            <button type="button" data-action="padrao" data-tipo="${tipo}"><i class="fa-solid fa-rotate-left"></i> ${t("Ajustes.Padrao")}</button>
          </div>
        </details>`;
    }).join("");

    return `
      <div class="lp-config">
        <p class="lp-aviso"><i class="fa-solid fa-circle-info"></i> ${t("Ajustes.Explicacao")}</p>
        ${cartoes}
        <footer class="lp-botoes lp-rodape">
          <button type="submit" class="lp-principal"><i class="fa-solid fa-floppy-disk"></i> ${t("Config.Salvar")}</button>
        </footer>
      </div>`;
  }

  _replaceHTML(result, content) {
    const abertos = new Set([...content.querySelectorAll("details[open]")].map(d => d.dataset.tipo));
    content.innerHTML = result;
    for (const d of content.querySelectorAll("details")) if (abertos.has(d.dataset.tipo)) d.open = true;
  }

  /** Lê o formulário e devolve { tipo: { ...ajustes } }. */
  static lerFormulario(form) {
    const dados = {};
    for (const tipo of LISTA) dados[tipo] = {};
    for (const el of form.elements) {
      if (!el.name?.includes(".")) continue;
      const [tipo, chave] = el.name.split(".");
      if (!dados[tipo]) continue;
      if (el.type === "checkbox") dados[tipo][chave] = el.checked;
      else {
        const n = Number(el.value);
        dados[tipo][chave] = Number.isFinite(n) ? Math.clamp(n, Number(el.min ?? -Infinity), Number(el.max ?? Infinity)) : 0;
      }
    }
    return dados;
  }

  static async #salvar(event, form) {
    await game.settings.set(ID, "minijogos", JanelaMinijogos.lerFormulario(form));
    ui.notifications.info(t("Ajustes.Salvo"));
  }

  static async #testar(event, alvo) {
    const tipo = alvo.dataset.tipo;
    // testa com o que está na tela agora, mesmo sem salvar
    const atual = JanelaMinijogos.lerFormulario(this.form ?? this.element);
    const { jogar, parametros } = await import("./jogos.js");
    const nivel = 5;
    const p = parametros({ nivel, cd: 15, tempo: 40 }, null, {}, tipo, atual[tipo]);
    jogar(tipo, { parametros: p, nome: t("Ajustes.FechaduraTeste") });
  }

  static async #padrao(event, alvo) {
    const tipo = alvo.dataset.tipo;
    const tudo = foundry.utils.deepClone(game.settings.get(ID, "minijogos") ?? {});
    delete tudo[tipo];
    await game.settings.set(ID, "minijogos", tudo);
    this.render();
  }
}

