// Gazua da Mesa — o que só o mestre pode fazer: trancar, destrancar, gastar chaves.
// Os jogadores mandam pedidos por socket; o mestre ativo confere e executa.

import {
  ID, SOCKET, REMOTOS, t, esc, cfg, lerFechadura, lerChave, lerGazua, usosItem, estaTrancada, chaveServe, nomeFechadura, apiDados,
  aoAlcance, gazuaDoAtor
} from "./dados.js";

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

const NIVEIS_AVISO = ["info", "warn", "error"];

// senderId é quem realmente mandou a mensagem (vem do próprio socket, não do conteúdo)
export function aoReceber(msg, senderId) {
  if (!msg || typeof msg !== "object" || !senderId) return;
  if (msg.tipo === "pedido" && souMestreAtivo()) return processar(msg.pedido, senderId);
  // as mensagens abaixo só o mestre manda
  if (!game.users.get(senderId)?.isGM) return;
  if (msg.tipo === "aviso" && msg.para === game.user.id) {
    const nivel = NIVEIS_AVISO.includes(msg.nivel) ? msg.nivel : "info";
    return ui.notifications[nivel](t(msg.chave, msg.dados));
  }
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
}

// ---------- Pedidos ----------

// Rolagens de chat já aproveitadas (cada rolagem só vale para uma tentativa)
const rolagensUsadas = new Set();
// Quem passou no teste antes do minijogo (pelo Dados em Cena): "userId:uuid" -> quando
const liberados = new Map();
const VALIDADE = 10 * 60000;

/** Lê o total da rolagem de Ferramentas de Ladrão feita pelo próprio remetente; null se não vale. */
function lerRolagem(mensagemId, user) {
  if (!mensagemId || rolagensUsadas.has(mensagemId)) return null;
  const m = game.messages.get(mensagemId);
  if (!m || m.author?.id !== user.id) return null;
  if (Date.now() - (m.timestamp ?? 0) > VALIDADE) return null;
  const total = Number(m.rolls?.[0]?.total);
  if (!Number.isFinite(total)) return null;
  rolagensUsadas.add(mensagemId);
  return total;
}

/** O ator do pedido pertence ao remetente e está ao alcance da fechadura? Devolve a chave do aviso ou null. */
function conferirPedido(doc, f, actor, user) {
  if (!actor || actor.documentName !== "Actor") return "Aviso.SemToken";
  if (!user.isGM && !actor.testUserPermission(user, "OWNER")) return "Aviso.NaoSeuPersonagem";
  if (user.isGM || REMOTOS.includes(doc.documentName)) return null;
  const tokens = (doc.parent?.tokens?.contents ?? []).filter(td => td.actor === actor);
  if (!tokens.some(td => aoAlcance(td, doc, f))) return "Aviso.Longe";
  return null;
}

/** Registra a falha: conta a tentativa, avisa no chat e desgasta a gazua. */
async function falhar(doc, f, actor, userId, gazuaUuid, via) {
  const falhas = Number(f.falhas?.[actor.id] ?? 0);
  await doc.update({ [`flags.${ID}.fechadura.falhas.${actor.id}`]: falhas + 1 });
  await anunciar(`<i class="fa-solid fa-lock"></i> ${t("Chat.Falhou", { ator: esc(actor.name), nome: esc(nomeFechadura(doc, f)) })}`, actor);
  await desgastarGazua(gazuaUuid, actor, userId, via);
}

export async function processar(pedido, userId) {
  if (!pedido || typeof pedido !== "object") return;
  try {
    const user = game.users.get(userId);
    const doc = await fromUuid(String(pedido.uuid ?? ""));
    const f = lerFechadura(doc);
    const actor = pedido.actorUuid ? await fromUuid(String(pedido.actorUuid)) : null;
    const desistir = () => { if (pedido.tipo === "testeDC") responderTeste(userId, pedido.pedidoId, null); };
    if (!user) return;
    if (!doc || !f) { desistir(); return avisar(userId, "Aviso.SemFechadura", {}, "warn"); }
    if (!estaTrancada(doc, f)) { desistir(); return avisar(userId, "Aviso.JaAberta"); }
    const problema = conferirPedido(doc, f, actor, user);
    if (problema) { desistir(); return avisar(userId, problema, {}, "warn"); }

    // Arrombar (teste ou minijogo): o mestre confere o modo, as tentativas e a gazua
    const prepararArrombar = () => {
      if (f.modo === "chave") return { erro: "Aviso.SoChave" };
      const falhas = Number(f.falhas?.[actor.id] ?? 0);
      if (f.tentativas > 0 && falhas >= f.tentativas) return { erro: "Aviso.SemTentativas" };
      const gazua = gazuaDoAtor(actor);
      if (f.exigeFerramentas && !gazua) return { erro: "Janela.SemFerramentas" };
      return { gazua, bonus: lerGazua(gazua)?.bonus ?? 0 };
    };

    if (pedido.tipo === "testeDC") {
      const prep = prepararArrombar();
      if (prep.erro) { desistir(); return avisar(userId, prep.erro, {}, "warn"); }
      const api = apiDados();
      let r = null;
      try {
        r = api && await api.pedirTeste({
          tokenId: pedido.tokenId, actorId: actor.id, sceneId: pedido.sceneId,
          config: { kind: "tool", toolKey: "thief", label: t("Teste.Ferramenta") },
          cd: Number(f.cd), modo: pedido.modo === "simples" ? "chat" : "tela",
          para: [userId], bonus: prep.bonus, tempoLimite: 120000
        });
      } catch (e) { console.error(`${ID} | Dados em Cena`, e); }
      const total = Number.isFinite(Number(r?.total)) ? Number(r.total) : null;
      responderTeste(userId, pedido.pedidoId, total);
      if (total == null) return;
      // o mestre já tem o resultado: decide aqui mesmo
      const passou = total >= Number(f.cd);
      if (!passou) return falhar(doc, f, actor, userId, prep.gazua?.uuid, "teste");
      if (pedido.finalidade === "minigame") { liberados.set(`${userId}:${doc.uuid}`, Date.now()); return; }
      return destrancar(doc, { actor, userId, como: t("Chat.ComTeste") });
    }

    if (pedido.tipo === "chave") {
      const item = await fromUuid(String(pedido.itemUuid ?? ""));
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
      const prep = prepararArrombar();
      if (prep.erro) return avisar(userId, prep.erro, {}, "warn");
      const via = pedido.via === "minigame" ? "minigame" : "teste";
      let sucesso;
      if (via === "teste") {
        // o veredito sai da rolagem no chat, lida aqui no mestre
        const total = lerRolagem(pedido.mensagemId, user);
        if (total == null) return avisar(userId, "Aviso.SemRolagem", {}, "warn");
        sucesso = total + prep.bonus >= Number(f.cd);
      } else {
        // minijogo: o resultado ainda vem do cliente; o mestre confere ao menos o teste antes
        if (f.testeAntes && !user.isGM) {
          const chave = `${userId}:${doc.uuid}`;
          let passou = Date.now() - (liberados.get(chave) ?? -Infinity) <= VALIDADE;
          if (!passou) {
            const total = lerRolagem(pedido.mensagemId, user);
            passou = total != null && total + prep.bonus >= Number(f.cd);
          }
          if (!passou) return avisar(userId, "Aviso.SemRolagem", {}, "warn");
          liberados.delete(chave);
        }
        sucesso = pedido.sucesso === true;
      }
      const como = t(via === "minigame" ? "Chat.ComGazua" : "Chat.ComTeste");
      if (sucesso) return destrancar(doc, { actor, userId, como });
      return falhar(doc, f, actor, userId, prep.gazua?.uuid, via);
    }
  } catch (e) {
    console.error(`${ID} | pedido`, pedido, e);
    if (pedido.tipo === "testeDC") responderTeste(userId, pedido.pedidoId, null);
    avisar(userId, "Aviso.Erro", {}, "error");
  }
}
