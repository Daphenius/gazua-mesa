// Gazua da Mesa — janelas do jogador: a fechadura (usar chave / arrombar) e as fechaduras por perto.

import {
  ID, t, esc, cfg, REMOTOS, lerFechadura, lerChave, estaTrancada, chaveServe, nomeFechadura, iconeTipo,
  chavesDoAtor, gazuaDoAtor, gazuaGuardada, lerGazua, usosItem, apiDados, aoAlcance, tokenDoUsuario, todasFechaduras, distanciaCasas
} from "./dados.js";
import { pedir, esperarTeste } from "./mestre.js";
import { jogar, escolherJogo, parametros, JOGOS } from "./jogos.js";

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

/** Quantas gazuas o item representa: usos restantes (coluna "Usos") e as outras unidades. */
function totalGazuas(item) {
  const qtd = Number(item?.system?.quantity) || 1;
  const u = usosItem(item);
  return u ? u.restam + u.max * (qtd - 1) : qtd;
}

export class JanelaFechadura extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["gazua-mesa", "lp-janela"],
    window: { icon: "fa-solid fa-lock" },
    position: { width: 420 },
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
    const remoto = REMOTOS.includes(doc.documentName);

    const heroi = `
      <div class="lp-heroi ${trancada ? "fechada" : "aberta"}">
        <div class="lp-cadeado"><i class="fa-solid ${trancada ? "fa-lock" : "fa-lock-open"}"></i></div>
        <div class="lp-heroi-txt">
          <small><i class="fa-solid ${iconeTipo(doc.documentName)}"></i> ${t(`Tipo.${doc.documentName}`)}</small>
          <strong>${esc(nomeFechadura(doc, f))}</strong>
          <span class="lp-selo-estado">${t(trancada ? "Janela.Trancada" : "Janela.Aberta")}</span>
        </div>
        ${remoto ? "" : `<div class="lp-dificuldade" data-tooltip="${esc(t("Janela.Nivel", { n: nivel }))}">
          <span>${t("Janela.NivelCurto", { n: nivel })}</span>
          <div class="lp-nivel-barra"><div style="width:${nivel * 10}%"></div></div>
        </div>`}
      </div>`;

    if (!trancada) {
      return `${heroi}<p class="lp-aberta"><i class="fa-solid fa-circle-check"></i> ${t("Janela.Destrancada")}</p>`;
    }

    // Chaves: o jogador experimenta qualquer uma; o mestre confere
    const chaves = chavesDoAtor(actor).map(i => {
      const c = lerChave(i);
      const extra = c.mestra
        ? `<em><i class="fa-solid fa-crown"></i> ${t("Janela.Mestra")}${c.usosMax > 0 ? ` · ${t("Janela.Usos", { n: c.usosMax - c.usados })}` : ""}</em>` : "";
      return `<button type="button" class="lp-chave" data-action="usarChave" data-item="${i.uuid}" data-tooltip="${esc(t("Janela.UsarChave", { chave: i.name }))}">
          <img src="${esc(i.img)}" alt=""><span>${esc(i.name)}${extra}</span><i class="fa-solid fa-arrow-right-to-bracket"></i>
        </button>`;
    }).join("");
    let corpo = `<h4><i class="fa-solid fa-key"></i> ${t("Janela.Chaves")}</h4>`;
    corpo += chaves ? `<div class="lp-chaves">${chaves}</div>` : `<p class="lp-vazio">${t("Janela.SemChaves")}</p>`;

    // Arrombar
    if (f.modo !== "chave" && !remoto) {
      const falhas = Number(f.falhas?.[actor?.id] ?? 0);
      const esgotou = f.tentativas > 0 && falhas >= f.tentativas;
      const gazua = gazuaDoAtor(actor);
      const semFerr = f.exigeFerramentas && !gazua;
      const guardada = semFerr ? gazuaGuardada(actor) : null;
      const bloqueio = esgotou ? t("Janela.Esgotou")
        : guardada ? t("Janela.Equipe", { nome: esc(guardada.name) })
        : semFerr ? t("Janela.SemFerramentas") : "";
      const dis = bloqueio || this.ocupado ? "disabled" : "";
      const cd = cfg("mostrarCD") ? ` · ${t("Janela.CD")} ${f.cd}` : "";
      const acao = (acao, icone, titulo, sub) => `
        <button type="button" class="lp-acao" data-action="${acao}" ${dis}>
          <i class="fa-solid ${icone}"></i><span><b>${titulo}</b><small>${sub}</small></span>
        </button>`;
      const botoes = [];
      if (f.modo === "teste" || f.modo === "ambos") botoes.push(acao("teste", "fa-dice-d20", t("Janela.Teste"), t("Janela.TesteDica") + cd));
      if (f.modo === "minigame" || f.modo === "ambos") {
        const jogo = JOGOS.includes(f.minijogo) ? t(`Jogo.${f.minijogo}.Nome`) : t("Janela.JogoSurpresa");
        const tempo = f.tempo > 0 ? ` · ${f.tempo}s` : "";
        const sub = (f.testeAntes ? t("Janela.MinigameComTeste", { jogo }) : jogo) + tempo;
        botoes.push(acao("minigame", "fa-unlock-keyhole", t("Janela.Minigame"), sub));
      }
      corpo += `<h4><i class="fa-solid fa-screwdriver"></i> ${t("Janela.Arrombar")}</h4><div class="lp-acoes">${botoes.join("")}</div>`;
      if (gazua && !bloqueio) {
        const g = lerGazua(gazua);
        const info = g ? [g.bonus > 0 ? `+${g.bonus}` : "", g.usosMax > 1 ? t("Janela.GazuaUsos", { n: g.usosMax - g.usados }) : "",
          totalGazuas(gazua) > 1 ? t("Janela.GazuaQtd", { n: totalGazuas(gazua) }) : ""].filter(Boolean).join(" · ") : "";
        corpo += `<p class="lp-gazua-usada"><img src="${esc(gazua.img)}" alt=""> ${t("Janela.ComGazua", { nome: esc(gazua.name) })}${info ? ` <em>${info}</em>` : ""}</p>`;
      }
      if (bloqueio) corpo += `<p class="lp-bloqueio"><i class="fa-solid fa-ban"></i> ${bloqueio}</p>`;
      else if (f.tentativas > 0) corpo += `<p class="lp-dica">${t("Janela.Restam", { n: f.tentativas - falhas })}</p>`;
    }

    if (f.modo !== "chave" && !remoto) {
      corpo += `<details class="lp-como-abrir"><summary><i class="fa-solid fa-circle-question"></i> ${t("Janela.ComoAbrir")}</summary>
        <ol>${[1, 2, 3, 4].map(n => `<li>${t(`Janela.ComoAbrir${n}`)}</li>`).join("")}</ol></details>`;
    }
    const quem = actor ? `<p class="lp-quem"><img src="${esc(actor.img ?? "")}" alt=""> ${t("Janela.Personagem", { nome: esc(actor.name) })}</p>` : "";
    return `${heroi}${corpo}${quem}`;
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

  /**
   * Teste de Ferramentas de Ladrão (pelo Dados em Cena, se ligado).
   * Devolve { total, mensagemId, peloMestre } ou null. Com o Dados em Cena, o mestre já decide o resultado
   * (peloMestre); sem ele, a rolagem vai para o chat e o mestre lê o total de lá pela mensagemId.
   */
  async #fazerTeste(f, bonus, finalidade) {
    const nome = nomeFechadura(this.doc, f);
    const modo = cfg("testeDadosEmCena");
    let total, mensagemId = null, peloMestre = false;
    if (modo !== "desligado" && apiDados()) {
      if (!game.users.activeGM) { ui.notifications.warn(t("Aviso.SemMestre")); return null; }
      const pedidoId = foundry.utils.randomID();
      const espera = esperarTeste(pedidoId);
      const tdoc = this.token?.document ?? this.token;
      pedir({
        tipo: "testeDC", pedidoId, uuid: this.doc.uuid, actorUuid: this.actor.uuid,
        tokenId: tdoc?.id, sceneId: tdoc?.parent?.id, modo, finalidade
      });
      ui.notifications.info(t("Janela.AguardandoTeste"));
      total = await espera;
      if (total == null) { ui.notifications.warn(t("Janela.TesteSemResposta")); return null; }
      peloMestre = true;
    } else {
      const rolado = await rolarTeste(this.actor, f, nome);
      if (rolado == null) return null;
      total = rolado.total + bonus;
      mensagemId = rolado.mensagemId;
    }
    const passou = total >= Number(f.cd);
    const cd = cfg("mostrarCD") ? ` (${t("Janela.CD")} ${f.cd})` : "";
    ui.notifications[passou ? "info" : "warn"](t(passou ? "Janela.TestePassou" : "Janela.TesteFalhou", { total, cd }));
    return { total, mensagemId, peloMestre };
  }

  static async #teste() {
    if (this.ocupado || !this.#conferir()) return;
    const f = lerFechadura(this.doc);
    const gazua = gazuaDoAtor(this.actor);
    const bonus = lerGazua(gazua)?.bonus ?? 0;
    this.ocupado = true;
    this.render();
    try {
      const r = await this.#fazerTeste(f, bonus, "teste");
      if (!r || r.peloMestre) return;   // pelo Dados em Cena o mestre já decidiu
      pedir({ tipo: "arrombar", via: "teste", uuid: this.doc.uuid, actorUuid: this.actor.uuid, mensagemId: r.mensagemId });
    } finally {
      this.ocupado = false;
      if (this.rendered) this.render();
    }
  }

  static async #minigame() {
    if (this.ocupado || !this.#conferir()) return;
    const f = lerFechadura(this.doc);
    const gazua = gazuaDoAtor(this.actor);
    const bonusGazua = lerGazua(gazua)?.bonus ?? 0;
    const nome = nomeFechadura(this.doc, f);
    const base = { uuid: this.doc.uuid, actorUuid: this.actor.uuid };
    this.ocupado = true;
    this.render();
    try {
      // Primeiro a CD: só quem passa consegue trabalhar a fechadura com a gazua
      let margem = 0, mensagemId = null;
      if (f.testeAntes) {
        const r = await this.#fazerTeste(f, bonusGazua, "minigame");
        if (!r) return;
        if (r.total < Number(f.cd)) {
          // pelo Dados em Cena o mestre já registrou a falha
          if (!r.peloMestre) pedir({ ...base, tipo: "arrombar", via: "teste", mensagemId: r.mensagemId });
          return;
        }
        margem = r.total - Number(f.cd);
        mensagemId = r.mensagemId;
      }
      const tipo = escolherJogo(f);
      const sucesso = await jogar(tipo, { parametros: parametros(f, this.actor, { margem, bonusGazua }, tipo), nome });
      if (sucesso === null) return;   // o minijogo nem abriu (erro já avisado)
      if (estaTrancada(this.doc)) pedir({ ...base, tipo: "arrombar", via: "minigame", sucesso, mensagemId });
    } catch (e) {
      console.error(`${ID} | minijogo`, e);
      ui.notifications.error(t("Aviso.ErroJogo"));
    } finally {
      this.ocupado = false;
      if (this.rendered) this.render();
    }
  }
}

/**
 * Teste de ferramentas de ladrão. Usa a rolagem do D&D 5e quando dá; senão, d20 + Destreza.
 * Devolve { total, mensagemId } (a mensagem do chat é o que o mestre confere) ou null se o jogador cancelou.
 */
export async function rolarTeste(actor, f, nome) {
  if (typeof actor.rollToolCheck === "function" && (actor.system?.tools?.thief || CONFIG.DND5E?.tools?.thief)) {
    try {
      const r = await actor.rollToolCheck({ tool: "thief", target: Number(f.cd) });
      const roll = Array.isArray(r) ? r[0] : r;
      if (!roll) return null;   // o jogador cancelou
      const total = Number(roll.total);
      // a mensagem que o sistema acabou de criar com esta rolagem
      const msg = game.messages.contents.findLast(m => m.author?.id === game.user.id && m.rolls?.some(x => x.total === total));
      return { total, mensagemId: msg?.id ?? null };
    } catch (e) {
      console.warn(`${ID} | rollToolCheck falhou, usando rolagem simples`, e);
    }
  }
  // sem a rolagem do sistema: d20 + Destreza
  const mod = Number(actor.system?.abilities?.dex?.mod) || 0;
  const roll = await new Roll("1d20 + @mod", { mod }).evaluate();
  const msg = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: t("Janela.FlavorTeste", { nome: esc(nome) }) });
  return { total: roll.total, mensagemId: msg?.id ?? null };
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
