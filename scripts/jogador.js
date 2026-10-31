// Gazua da Mesa — janelas do jogador: a fechadura (usar chave / arrombar) e as fechaduras por perto.

import {
  ID, t, esc, cfg, REMOTOS, lerFechadura, lerChave, estaTrancada, chaveServe, nomeFechadura, iconeTipo,
  chavesDoAtor, ferramentasLadrao, aoAlcance, tokenDoUsuario, todasFechaduras, distanciaCasas
} from "./dados.js";
import { pedir } from "./mestre.js";
import { Gazua, parametros } from "./minigame.js";

const { ApplicationV2 } = foundry.applications.api;

const abertas = new Map(); // uuid -> JanelaFechadura

/** Abre a janela de uma fechadura para o token do usuário. */
export function abrirFechadura(doc, token = tokenDoUsuario()) {
  if (!lerFechadura(doc)) return;
  if (!token?.actor) return ui.notifications.warn(t("Aviso.SemToken"));
  if (!game.user.isGM && !aoAlcance(token, doc)) return ui.notifications.warn(t("Aviso.Longe"));
  const ja = abertas.get(doc.uuid);
  if (ja) { ja.token = token; return ja.render({ force: true }); }
  const j = new JanelaFechadura({ documento: doc, token });
  abertas.set(doc.uuid, j);
  return j.render({ force: true });
}

/** Re-desenha as janelas abertas quando algo muda. */
export function atualizarJanelas(doc) {
  for (const j of abertas.values()) {
    if (!doc || j.doc === doc || j.doc.uuid === doc.uuid || j.token?.actor === doc.parent || j.token?.actor === doc) j.render();
  }
  for (const app of foundry.applications.instances?.values?.() ?? []) {
    if (app instanceof JanelaProximas) app.render();
  }
}

export class JanelaFechadura extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["gazua-mesa", "lp-janela"],
    window: { icon: "fa-solid fa-lock" },
    position: { width: 400 },
    actions: {
      usarChave: JanelaFechadura.#usarChave,
      teste: JanelaFechadura.#teste,
      minigame: JanelaFechadura.#minigame
    }
  };

  constructor(options) {
    super(options);
    this.doc = options.documento;
    this.token = options.token;
    this.ocupado = false;
  }

  get title() {
    return nomeFechadura(this.doc);
  }

  get actor() {
    return this.token?.actor ?? null;
  }

  async _renderHTML() {
    const doc = this.doc, f = lerFechadura(doc), actor = this.actor;
    if (!f) return `<p class="lp-vazio">${t("Aviso.SemFechadura")}</p>`;
    const trancada = estaTrancada(doc, f);
    const nivel = Math.clamp(Number(f.nivel) || 1, 1, 10);
    const pontos = Array.from({ length: 10 }, (_, i) => `<span class="${i < nivel ? "on" : ""}"></span>`).join("");

    let corpo = "";
    if (!trancada) {
      corpo = `<p class="lp-aberta"><i class="fa-solid fa-lock-open"></i> ${t("Janela.Destrancada")}</p>`;
    } else {
      // Chaves: o jogador experimenta qualquer uma; o mestre confere
      const chaves = chavesDoAtor(actor);
      const linhas = chaves.map(i => {
        const c = lerChave(i);
        const extra = c.mestra
          ? `<em>${t("Janela.Mestra")}${c.usosMax > 0 ? ` · ${t("Janela.Usos", { n: c.usosMax - c.usados })}` : ""}</em>` : "";
        return `<li><img src="${esc(i.img)}" alt=""><span>${esc(i.name)} ${extra}</span>
          <button type="button" data-action="usarChave" data-item="${i.uuid}"><i class="fa-solid fa-key"></i> ${t("Janela.Usar")}</button></li>`;
      }).join("");
      corpo += `<h4><i class="fa-solid fa-key"></i> ${t("Janela.Chaves")}</h4>`;
      corpo += linhas ? `<ul class="lp-chaves">${linhas}</ul>` : `<p class="lp-vazio">${t("Janela.SemChaves")}</p>`;

      // Arrombar
      if (f.modo !== "chave" && !REMOTOS.includes(doc.documentName)) {
        const falhas = Number(f.falhas?.[actor?.id] ?? 0);
        const esgotou = f.tentativas > 0 && falhas >= f.tentativas;
        const semFerr = f.exigeFerramentas && !ferramentasLadrao(actor);
        const bloqueio = esgotou ? t("Janela.Esgotou") : semFerr ? t("Janela.SemFerramentas") : "";
        const dis = bloqueio || this.ocupado ? "disabled" : "";
        const cd = cfg("mostrarCD") ? ` (${t("Janela.CD")} ${f.cd})` : "";
        const botoes = [];
        if (f.modo === "teste" || f.modo === "ambos") {
          botoes.push(`<button type="button" data-action="teste" ${dis}><i class="fa-solid fa-dice-d20"></i> ${t("Janela.Teste")}${cd}</button>`);
        }
        if (f.modo === "minigame" || f.modo === "ambos") {
          botoes.push(`<button type="button" data-action="minigame" ${dis}><i class="fa-solid fa-unlock-keyhole"></i> ${t("Janela.Minigame")}</button>`);
        }
        corpo += `<h4><i class="fa-solid fa-screwdriver"></i> ${t("Janela.Arrombar")}</h4><div class="lp-botoes">${botoes.join("")}</div>`;
        if (bloqueio) corpo += `<p class="lp-bloqueio">${bloqueio}</p>`;
        else if (f.tentativas > 0) corpo += `<p class="lp-dica">${t("Janela.Restam", { n: f.tentativas - falhas })}</p>`;
      }
    }

    return `
      <div class="lp-topo">
        <i class="fa-solid ${iconeTipo(doc.documentName)}"></i>
        <div>
          <div class="lp-estado ${trancada ? "fechada" : "aberta"}">${t(trancada ? "Janela.Trancada" : "Janela.Aberta")}</div>
          <div class="lp-nivel" data-tooltip="${esc(t("Janela.Nivel", { n: nivel }))}">${pontos}</div>
        </div>
        <span class="lp-quem">${esc(actor?.name ?? "")}</span>
      </div>
      ${corpo}`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onClose(options) {
    super._onClose?.(options);
    if (abertas.get(this.doc.uuid) === this) abertas.delete(this.doc.uuid);
  }

  #conferir() {
    if (!this.actor) { ui.notifications.warn(t("Aviso.SemToken")); return false; }
    if (!game.user.isGM && !aoAlcance(this.token, this.doc)) { ui.notifications.warn(t("Aviso.Longe")); return false; }
    return true;
  }

  static async #usarChave(event, alvo) {
    if (!this.#conferir()) return;
    const item = await fromUuid(alvo.dataset.item);
    const f = lerFechadura(this.doc);
    if (!item || !f) return;
    if (!chaveServe(lerChave(item), f).serve) {
      return ui.notifications.warn(t("Aviso.NaoServe", { chave: item.name }));
    }
    pedir({ tipo: "chave", uuid: this.doc.uuid, actorUuid: this.actor.uuid, itemUuid: item.uuid });
  }

  static async #teste() {
    if (this.ocupado || !this.#conferir()) return;
    const f = lerFechadura(this.doc);
    this.ocupado = true;
    try {
      const total = await rolarTeste(this.actor, f, nomeFechadura(this.doc, f));
      if (total == null) return;
      pedir({ tipo: "arrombar", via: "teste", uuid: this.doc.uuid, actorUuid: this.actor.uuid, sucesso: total >= Number(f.cd), total });
    } finally {
      this.ocupado = false;
      if (this.rendered) this.render();
    }
  }

  static async #minigame() {
    if (this.ocupado || !this.#conferir()) return;
    const f = lerFechadura(this.doc);
    this.ocupado = true;
    this.render();
    try {
      const sucesso = await Gazua.jogar({ parametros: parametros(f, this.actor), nome: nomeFechadura(this.doc, f) });
      if (estaTrancada(this.doc)) pedir({ tipo: "arrombar", via: "minigame", uuid: this.doc.uuid, actorUuid: this.actor.uuid, sucesso });
    } finally {
      this.ocupado = false;
      if (this.rendered) this.render();
    }
  }
}

/** Teste de ferramentas de ladrão. Usa a rolagem do D&D 5e quando dá; senão, d20 + Destreza. */
export async function rolarTeste(actor, f, nome) {
  if (typeof actor.rollToolCheck === "function" && actor.system?.tools?.thief) {
    try {
      const r = await actor.rollToolCheck({ tool: "thief", target: Number(f.cd) });
      const roll = Array.isArray(r) ? r[0] : r;
      return roll ? Number(roll.total) : null;   // null: o jogador cancelou
    } catch (e) {
      console.warn(`${ID} | rollToolCheck falhou, usando rolagem simples`, e);
    }
  }
  const mod = Number(actor.system?.abilities?.dex?.mod) || 0;
  const roll = await new Roll("1d20 + @mod", { mod }).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: t("Janela.FlavorTeste", { nome: esc(nome) }) });
  return roll.total;
}

// ---------- Fechaduras por perto ----------

export function fechadurasPerto(token) {
  const actor = token?.actor;
  const chaves = chavesDoAtor(actor).map(lerChave);
  return todasFechaduras().filter(doc => {
    const f = lerFechadura(doc);
    if (!estaTrancada(doc, f)) return false;
    // diários: só aparecem se o personagem tem uma chave com o segredo deles
    if (REMOTOS.includes(doc.documentName)) return chaves.some(c => chaveServe(c, { ...f, aceitaMestra: false }).serve);
    // porta secreta ainda escondida não aparece
    if (doc.documentName === "Wall" && doc.door === CONST.WALL_DOOR_TYPES.SECRET && !game.user.isGM) return false;
    if (doc.documentName !== "Wall" && doc.hidden && !game.user.isGM) return false;
    return aoAlcance(token, doc, f);
  }).sort((a, b) => distanciaCasas(token, a) - distanciaCasas(token, b));
}

export function abrirProximas(token = tokenDoUsuario()) {
  if (!token?.actor) return ui.notifications.warn(t("Aviso.SemToken"));
  const lista = fechadurasPerto(token);
  if (!lista.length) return ui.notifications.info(t("Aviso.NadaPerto"));
  if (lista.length === 1) return abrirFechadura(lista[0], token);
  return new JanelaProximas({ token }).render({ force: true });
}

export class JanelaProximas extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["gazua-mesa", "lp-janela"],
    window: { title: "GAZUAMESA.Proximas.Titulo", icon: "fa-solid fa-key" },
    position: { width: 360 },
    actions: { abrir: JanelaProximas.#abrir }
  };

  constructor(options) {
    super(options);
    this.token = options.token;
  }

  async _renderHTML() {
    const lista = fechadurasPerto(this.token);
    if (!lista.length) return `<p class="lp-vazio">${t("Aviso.NadaPerto")}</p>`;
    return `<ul class="lp-lista">${lista.map(d => `
      <li data-action="abrir" data-uuid="${d.uuid}">
        <i class="fa-solid ${iconeTipo(d.documentName)}"></i>
        <span>${esc(nomeFechadura(d))}</span>
        <em>${t(`Tipo.${d.documentName}`)}</em>
      </li>`).join("")}</ul>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #abrir(event, alvo) {
    const doc = await fromUuid(alvo.dataset.uuid);
    if (doc) abrirFechadura(doc, this.token);
  }
}
