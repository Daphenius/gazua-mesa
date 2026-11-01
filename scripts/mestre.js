// Gazua da Mesa — o que só o mestre pode fazer: trancar, destrancar, gastar chaves.
// Os jogadores mandam pedidos por socket; o mestre ativo confere e executa.

import { ID, SOCKET, t, esc, cfg, lerFechadura, lerChave, lerGazua, usosItem, estaTrancada, chaveServe, nomeFechadura, apiDados } from "./dados.js";

const ESTADO = () => CONST.WALL_DOOR_STATES;
const NIVEL = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;

export const souMestreAtivo = () => game.user.isGM && (game.users.activeGM ?? game.user) === game.user;

// ---------- Comunicação ----------

/** Pedido de um jogador (ou do próprio mestre). */
export function pedir(pedido) {
  if (souMestreAtivo()) return processar(pedido, game.user.id);
  if (!game.users.activeGM) { ui.notifications.warn(t("Aviso.SemMestre")); return; }
  game.socket.emit(SOCKET, { tipo: "pedido", pedido, userId: game.user.id });
}

export function avisar(userId, chave, dados = {}, nivel = "info") {
  if (userId === game.user.id) return ui.notifications[nivel](t(chave, dados));
  game.socket.emit(SOCKET, { tipo: "aviso", para: userId, chave, dados, nivel });
}

function mostrarPara(userIds, uuid) {
  const meus = userIds.includes(game.user.id);
  const outros = userIds.filter(u => u !== game.user.id);
  if (outros.length) game.socket.emit(SOCKET, { tipo: "mostrar", para: outros, uuid });
  if (meus) mostrarDocumento(uuid);
}

export async function mostrarDocumento(uuid) {
  const doc = await fromUuid(uuid);
  if (!doc) return;
  if (doc.documentName === "JournalEntryPage") return doc.parent?.sheet?.render(true, { pageId: doc.id });
  return doc.sheet?.render(true);
}

// Testes pedidos ao Dados em Cena: o jogador espera aqui a resposta do mestre
const testesPendentes = new Map();

export function esperarTeste(pedidoId, tempo = 150000) {
  return new Promise(resolve => {
    const relogio = setTimeout(() => { testesPendentes.delete(pedidoId); resolve(null); }, tempo);
    testesPendentes.set(pedidoId, total => { clearTimeout(relogio); testesPendentes.delete(pedidoId); resolve(total); });
  });
}

function responderTeste(userId, pedidoId, total) {
  if (userId === game.user.id) return testesPendentes.get(pedidoId)?.(total);
  game.socket.emit(SOCKET, { tipo: "resultadoTeste", para: userId, pedidoId, total });
}

export function aoReceber(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.tipo === "pedido" && souMestreAtivo()) return processar(msg.pedido, msg.userId);
  if (msg.tipo === "aviso" && msg.para === game.user.id) return ui.notifications[msg.nivel ?? "info"](t(msg.chave, msg.dados));
  if (msg.tipo === "mostrar" && msg.para?.includes(game.user.id)) return mostrarDocumento(msg.uuid);
  if (msg.tipo === "resultadoTeste" && msg.para === game.user.id) return testesPendentes.get(msg.pedidoId)?.(msg.total);
}

// ---------- Chat ----------

async function anunciar(html, actor) {
  const modo = cfg("anuncio");
  if (modo === "nenhum") return;
  const data = {
    content: `<div class="gazua-mesa-chat">${html}</div>`,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: "Gazua da Mesa" }
  };
  if (modo === "mestre") data.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
  return ChatMessage.create(data);
}

// ---------- Estado ----------

/** Aplica o estado trancado/destrancado no que a fechadura controla. */
export async function sincronizar(doc, trancada) {
  const f = lerFechadura(doc);
  if (!f) return;

  if (doc.documentName === "Wall") {
    const E = ESTADO();
    if (trancada && doc.ds !== E.LOCKED) await doc.update({ ds: E.LOCKED });
    if (!trancada && doc.ds === E.LOCKED) await doc.update({ ds: E.CLOSED });
    return;
  }

  const upd = {};
  if (f.trancada !== trancada) upd[`flags.${ID}.fechadura.trancada`] = trancada;

  // Região trancada: os comportamentos dela (portais, gatilhos, teleportes) ficam desligados
  if (doc.documentName === "Region") {
    const comps = doc.behaviors?.contents ?? [];
    if (trancada) {
      const desligar = comps.filter(b => !b.disabled).map(b => b.id);
      if (desligar.length) {
        await doc.updateEmbeddedDocuments("RegionBehavior", desligar.map(_id => ({ _id, disabled: true })));
        upd[`flags.${ID}.fechadura.desativados`] = [...new Set([...(f.desativados ?? []), ...desligar])];
      }
    } else if (f.desativados?.length) {
      const religar = f.desativados.filter(id => doc.behaviors?.get(id));
      if (religar.length) await doc.updateEmbeddedDocuments("RegionBehavior", religar.map(_id => ({ _id, disabled: false })));
      upd[`flags.${ID}.fechadura.desativados`] = [];
    }
  }

  // Gatilho do Navegador de Mapas no mesmo objeto
  if (f.gatilho && doc.flags?.["navegador-mapas"]?.gatilho) upd["flags.navegador-mapas.gatilho.ativo"] = !trancada;

  if (Object.keys(upd).length) await doc.update(upd);

  // Baú do Item Piles
  if (doc.documentName === "Token" && doc.flags?.["item-piles"]?.data?.enabled) {
    const api = game.itempiles?.API;
    const fn = trancada ? api?.lockItemPile : api?.unlockItemPile;
    try {
      if (typeof fn === "function") await fn.call(api, doc);
      else await doc.update({ "flags.item-piles.data.locked": trancada });
    } catch (e) { console.error(`${ID} | Item Piles`, e); }
  }
}

async function darPermissao(doc, userIds, nivel) {
  if (!doc || !userIds.length) return;
  const N = NIVEL();
  const alvoNivel = N[nivel === "dono" ? "OWNER" : "OBSERVER"];
  const ownership = {};
  for (const u of userIds) if ((doc.ownership?.[u] ?? -1) < alvoNivel) ownership[u] = alvoNivel;
  if (Object.keys(ownership).length) await doc.update({ ownership });
  // Página: o diário precisa pelo menos de "limitado" para abrir
  if (doc.documentName === "JournalEntryPage" && doc.parent) {
    const pai = {};
    for (const u of userIds) if ((doc.parent.ownership?.[u] ?? -1) < N.LIMITED) pai[u] = N.LIMITED;
    if (Object.keys(pai).length) await doc.parent.update({ ownership: pai });
  }
}

function jogadores() {
  return game.users.filter(u => !u.isGM).map(u => u.id);
}

/** Destranca e aplica tudo o que foi configurado para acontecer. */
export async function destrancar(doc, { actor = null, userId = null, como = "" } = {}) {
  const f = lerFechadura(doc);
  if (!f) return;
  await sincronizar(doc, false);

  const quem = f.paraTodos ? jogadores() : (userId && !game.users.get(userId)?.isGM ? [userId] : []);
  const tipo = doc.documentName;

  if (tipo === "Wall" && f.abrirPorta) await doc.update({ ds: ESTADO().OPEN });

  if (["Tile", "Token"].includes(tipo) && f.visibilidade !== "nada") {
    await doc.update({ hidden: f.visibilidade === "esconder" });
  }

  if (tipo === "Token" && f.permissao !== "nenhuma" && !doc.flags?.["item-piles"]?.data?.enabled) {
    const ator = doc.actor?.isToken ? (doc.baseActor ?? game.actors.get(doc.actorId)) : doc.actor;
    await darPermissao(ator, quem, f.permissao);
    if (ator && quem.length) mostrarPara(quem, doc.actor.uuid);
  }

  if (["JournalEntry", "JournalEntryPage"].includes(tipo) && f.permissao !== "nenhuma") {
    await darPermissao(doc, quem, f.permissao);
    if (quem.length) mostrarPara(quem, doc.uuid);
  }

  if (f.journal) {
    const revelar = await fromUuid(f.journal);
    if (revelar) {
      await darPermissao(revelar, quem, "observador");
      if (quem.length) mostrarPara(quem, revelar.uuid);
    }
  }

  const nome = esc(nomeFechadura(doc, f));
  const texto = como
    ? t("Chat.Destrancou", { ator: esc(actor?.name ?? t("Chat.Alguem")), nome, como })
    : t("Chat.DestrancouSimples", { nome });
  let html = `<i class="fa-solid fa-lock-open"></i> ${texto}`;
  if (f.mensagem) {
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    html += `<p class="lp-msg">${await TE.enrichHTML(f.mensagem)}</p>`;
  }
  await anunciar(html, actor);

  if (f.macro) {
    try {
      const macro = await fromUuid(f.macro);
      await macro?.execute({ fechadura: doc, actor, token: actor?.getActiveTokens?.()[0] ?? null });
    } catch (e) { console.error(`${ID} | macro`, e); ui.notifications.error(t("Aviso.ErroMacro")); }
  }
  Hooks.callAll(`${ID}.destrancou`, doc, { actor, userId, como });
}

export async function trancar(doc) {
  if (!lerFechadura(doc)) return;
  await sincronizar(doc, true);
  Hooks.callAll(`${ID}.trancou`, doc);
}

async function gastarItem(item) {
  const q = Number(item.system?.quantity);
  if (q > 1) return item.update({ "system.quantity": q - 1 });
  return item.delete();
}

/**
 * A gazua quebra na falha (conforme a opção "Quando a gazua quebra"): some uma unidade do inventário.
 * Uma gazua marcada pelo mestre pode aguentar mais de uma falha por unidade.
 */
async function desgastarGazua(uuid, actor, userId, via) {
  const modo = cfg("quebraGazua");
  const quebra = modo === "ambos" || (modo === "testes" && via === "teste") || (modo === "minijogos" && via === "minigame");
  if (!quebra || !uuid) return;
  const item = await fromUuid(uuid);
  if (!item || item.parent?.uuid !== actor?.uuid) return;
  const g = lerGazua(item);
  const limite = Math.max(1, Number(g?.usosMax) || 1);
  const usados = (Number(g?.usados) || 0) + 1;
  if (g && usados < limite) {
    await item.update({ [`flags.${ID}.gazua.usados`]: usados });
    return avisar(userId, "Aviso.GazuaDesgastou", { nome: item.name, n: limite - usados }, "warn");
  }
  const nome = item.name;
  const qtd = Number(item.system?.quantity) || 1;
  const usos = usosItem(item);
  let restam;
  if (usos) {
    // gazuas contadas nos "Usos" da ficha: cada quebra gasta um uso
    const extra = g ? { [`flags.${ID}.gazua.usados`]: 0 } : {};
    if (usos.restam > 1) {
      await item.update({ "system.uses.spent": usos.gastos + 1, ...extra });
      restam = usos.restam - 1 + usos.max * (qtd - 1);
    } else if (qtd > 1) {
      await item.update({ "system.quantity": qtd - 1, "system.uses.spent": 0, ...extra });
      restam = usos.max * (qtd - 1);
    } else {
      await item.delete();
      restam = 0;
    }
  } else {
    if (qtd > 1) {
      const upd = { "system.quantity": qtd - 1 };
      if (g) upd[`flags.${ID}.gazua.usados`] = 0;
      await item.update(upd);
    } else {
      await item.delete();
    }
    restam = qtd - 1;
  }
  avisar(userId, "Aviso.GazuaQuebrou", { nome, restam }, "warn");
  await anunciar(`<i class="fa-solid fa-screwdriver"></i> ${t("Chat.GazuaQuebrou", { ator: esc(actor?.name ?? t("Chat.Alguem")), nome: esc(nome), restam })}`, actor);
  if (restam <= 0) console.info(`${ID} | "${nome}" de ${actor?.name} acabou e foi removida do inventário (todas as gazuas quebraram).`);
}

// ---------- Pedidos ----------

export async function processar(pedido, userId) {
  try {
    const doc = await fromUuid(pedido.uuid);
    const f = lerFechadura(doc);
    const actor = pedido.actorUuid ? await fromUuid(pedido.actorUuid) : null;
    const desistir = () => { if (pedido.tipo === "testeDC") responderTeste(userId, pedido.pedidoId, null); };
    if (!doc || !f) { desistir(); return avisar(userId, "Aviso.SemFechadura", {}, "warn"); }
    if (!estaTrancada(doc, f)) { desistir(); return avisar(userId, "Aviso.JaAberta"); }

    const nome = esc(nomeFechadura(doc, f));

    if (pedido.tipo === "testeDC") {
      const api = apiDados();
      let r = null;
      try {
        r = api && await api.pedirTeste({
          tokenId: pedido.tokenId, actorId: actor?.id, sceneId: pedido.sceneId,
          config: { kind: "tool", toolKey: "thief", label: t("Teste.Ferramenta") },
          cd: Number(f.cd), modo: pedido.modo === "simples" ? "chat" : "tela",
          para: [userId], bonus: Number(pedido.bonus) || 0, tempoLimite: 120000
        });
      } catch (e) { console.error(`${ID} | Dados em Cena`, e); }
      return responderTeste(userId, pedido.pedidoId, r?.total ?? null);
    }

    if (pedido.tipo === "chave") {
      const item = await fromUuid(pedido.itemUuid);
      const chave = lerChave(item);
      if (!item || !chave || item.parent?.uuid !== actor?.uuid) return avisar(userId, "Aviso.ChaveSumiu", {}, "warn");
      const r = chaveServe(chave, f);
      if (!r.serve) return avisar(userId, "Aviso.NaoServe", { chave: item.name }, "warn");
      const nomeChave = esc(item.name);
      if (r.porMestra) {
        const usados = (chave.usados ?? 0) + 1;
        if (chave.usosMax > 0 && usados >= chave.usosMax) {
          await gastarItem(item);
          avisar(userId, "Aviso.MestraGasta", { chave: item.name }, "warn");
        } else {
          await item.update({ [`flags.${ID}.chave.usados`]: usados });
        }
      } else {
        await gastarItem(item);
      }
      return destrancar(doc, { actor, userId, como: t("Chat.ComChave", { chave: nomeChave }) });
    }

    if (pedido.tipo === "arrombar") {
      if (f.modo === "chave") return avisar(userId, "Aviso.SoChave", {}, "warn");
      const falhas = Number(f.falhas?.[actor?.id] ?? 0);
      if (f.tentativas > 0 && falhas >= f.tentativas) return avisar(userId, "Aviso.SemTentativas", {}, "warn");
      const como = t(pedido.via === "minigame" ? "Chat.ComGazua" : "Chat.ComTeste");
      if (pedido.sucesso) return destrancar(doc, { actor, userId, como });
      if (actor) await doc.update({ [`flags.${ID}.fechadura.falhas.${actor.id}`]: falhas + 1 });
      await anunciar(`<i class="fa-solid fa-lock"></i> ${t("Chat.Falhou", { ator: esc(actor?.name ?? t("Chat.Alguem")), nome })}`, actor);
      await desgastarGazua(pedido.gazuaUuid, actor, userId, pedido.via);
      return;
    }
  } catch (e) {
    console.error(`${ID} | pedido`, pedido, e);
    if (pedido.tipo === "testeDC") responderTeste(userId, pedido.pedidoId, null);
    avisar(userId, "Aviso.Erro", {}, "error");
  }
}
