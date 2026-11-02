// Gazua da Mesa — o que só o mestre pode fazer: trancar, destrancar, gastar chaves.
// Os jogadores mandam pedidos por socket; o mestre ativo confere e executa.

import {
  ID, SOCKET, REMOTOS, t, esc, cfg, lerFechadura, lerChave, lerGazua, usosItem, estaTrancada, chaveServe, nomeFechadura, apiDados,
  aoAlcance, gazuaDoAtor, todasFechaduras, temEstoque
} from "./dados.js";
import { parametros, escolherJogo } from "./jogos.js";
import { conferir, novaSemente } from "./logica.js";

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

// Pedidos que esperam resposta do mestre (teste pelo Dados em Cena, início do minijogo).
// Sem resposta no prazo, a promessa termina com null.
const pendentes = new Map();

export function esperarResposta(pedidoId, tempo = 150000) {
  return new Promise(resolve => {
    const relogio = setTimeout(() => { pendentes.delete(pedidoId); resolve(null); }, tempo);
    pendentes.set(pedidoId, dados => { clearTimeout(relogio); pendentes.delete(pedidoId); resolve(dados); });
  });
}

function responder(userId, pedidoId, dados) {
  if (userId === game.user.id) return pendentes.get(pedidoId)?.(dados);
  game.socket.emit(SOCKET, { tipo: "resposta", para: userId, pedidoId, dados });
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
  if (msg.tipo === "resposta" && msg.para === game.user.id) return pendentes.get(msg.pedidoId)?.(msg.dados);
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
  // destrancou: os minijogos em andamento eram desta tentativa e acabam aqui
  if (!trancada) await encerrarSessoes(doc);

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
    html += `<p class="lp-msg">${await foundry.applications.ux.TextEditor.implementation.enrichHTML(f.mensagem)}</p>`;
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

/** Gasta uma unidade do item. `reiniciar` zera o desgaste da próxima unidade da pilha. */
async function gastarItem(item, reiniciar = {}) {
  const q = Number(item.system?.quantity);
  if (q > 1) return item.update({ "system.quantity": q - 1, ...reiniciar });
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
// Quem passou no teste antes do minijogo (pelo Dados em Cena): "userId:uuid" -> { quando, total }
const liberados = new Map();
const VALIDADE = 10 * 60000;

// ---------- Sessões de minijogo ----------
// Ao começar um minijogo, o mestre sorteia a semente e grava na fechadura (flags.gazua-mesa.jogos.<userId>):
// { actorUuid, tipo, semente, parametros, inicio, validade }. O jogador recebe a semente, joga e devolve
// as jogadas; o mestre refaz tudo com a mesma semente e decide. A sessão acaba quando o resultado chega
// (fechar a janela conta como desistência) ou quando passa da validade (conta como falha).

const ESPERA_JOGO = 5 * 60000;    // validade mínima de uma sessão
const FOLGA = 20000;              // atraso aceito entre o sorteio e a janela abrir no jogador
const relogios = new Map();       // "userId:uuid" -> setTimeout da expiração

export const lerSessao = (doc, userId) => doc?.flags?.[ID]?.jogos?.[userId] ?? null;

async function apagarSessao(doc, userId) {
  const k = `${userId}:${doc.uuid}`;
  clearTimeout(relogios.get(k));
  relogios.delete(k);
  if (lerSessao(doc, userId)) await doc.unsetFlag(ID, `jogos.${userId}`);
}

/** Encerra, sem falha, todos os minijogos em andamento na fechadura (ela foi destrancada). */
export async function encerrarSessoes(doc) {
  for (const k of [...relogios.keys()]) {
    if (k.endsWith(`:${doc.uuid}`)) { clearTimeout(relogios.get(k)); relogios.delete(k); }
  }
  if (Object.keys(doc.flags?.[ID]?.jogos ?? {}).length) await doc.unsetFlag(ID, "jogos");
}

function agendarExpiracao(doc, userId, s) {
  const k = `${userId}:${doc.uuid}`;
  clearTimeout(relogios.get(k));
  const espera = Math.max(0, s.validade - Date.now()) + 1000;
  relogios.set(k, setTimeout(() => {
    relogios.delete(k);
    emFila(() => expirar(doc, userId, s)).catch(e => console.error(`${ID} | expirar minijogo`, e));
  }, espera));
}

/** Sessão que passou da validade sem resultado: apaga e conta como falha. */
async function expirar(doc, userId, s) {
  if (!souMestreAtivo() || lerSessao(doc, userId)?.semente !== s.semente) return;
  await apagarSessao(doc, userId);
  const f = lerFechadura(doc);
  if (!f || !estaTrancada(doc, f)) return;
  const actor = await fromUuid(String(s.actorUuid ?? ""));
  if (!actor) return;
  avisar(userId, "Aviso.JogoExpirou", {}, "warn");
  await falhar(doc, f, actor, userId, gazuaDoAtor(actor)?.uuid, "minigame");
}

/** Ao entrar (ou trocar de mestre): sessões vencidas viram falha; as válidas voltam a ter relógio. */
export async function limparSessoes() {
  if (!souMestreAtivo()) return;
  const docs = [];
  for (const cena of game.scenes ?? []) docs.push(...todasFechaduras(cena).filter(d => d.parent === cena));
  docs.push(...todasFechaduras(null));
  for (const doc of new Set(docs)) {
    for (const [userId, s] of Object.entries(doc.flags?.[ID]?.jogos ?? {})) {
      if (!s) continue;
      if (Date.now() > s.validade) await emFila(() => expirar(doc, userId, s)).catch(e => console.error(`${ID} | expirar minijogo`, e));
      else agendarExpiracao(doc, userId, s);
    }
  }
}

// ---------- Fila ----------
// O mestre trata um pedido de cada vez, e cada um relê a fechadura e o inventário ao começar.
// Assim, dois cliques juntos não gastam duas chaves nem abrem a porta duas vezes.
// (A espera pela rolagem do Dados em Cena acontece fora da fila, para não travar os outros.)
let fila = Promise.resolve();

function emFila(fn) {
  const r = fila.then(() => fn());
  fila = r.catch(() => {});
  return r;
}

// ---------- Modalidades ----------
/** O teste simples (sozinho) pode destrancar esta fechadura? */
const testeAbre = f => f.modo === "teste" || f.modo === "ambos";
/** Esta fechadura aceita o minijogo? */
const aceitaMinijogo = f => f.modo === "minigame" || f.modo === "ambos";

/** Arrombar (teste ou minijogo): o mestre confere o modo, as tentativas e a gazua. */
function prepararArrombar(f, actor) {
  if (f.modo === "chave") return { erro: "Aviso.SoChave" };
  const falhas = Number(f.falhas?.[actor.id] ?? 0);
  if (f.tentativas > 0 && falhas >= f.tentativas) return { erro: "Aviso.SemTentativas" };
  const gazua = gazuaDoAtor(actor);
  if (f.exigeFerramentas && !gazua) return { erro: "Janela.SemFerramentas" };
  return { gazua, bonus: lerGazua(gazua)?.bonus ?? 0 };
}

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

/** Pedido de um jogador: entra na fila do mestre. */
export function processar(pedido, userId) {
  return emFila(() => processarAgora(pedido, userId));
}

async function processarAgora(pedido, userId) {
  if (!pedido || typeof pedido !== "object") return;
  try {
    const user = game.users.get(userId);
    const doc = await fromUuid(String(pedido.uuid ?? ""));
    const f = lerFechadura(doc);
    const actor = pedido.actorUuid ? await fromUuid(String(pedido.actorUuid)) : null;
    // pedidos que esperam resposta recebem "não" (false; null fica para quando o mestre não responde)
    const desistir = () => {
      if (pedido.tipo === "testeDC") responder(userId, pedido.pedidoId, false);
      if (pedido.tipo === "iniciarJogo") responder(userId, pedido.pedidoId, false);
    };
    if (!user) return;
    if (!doc || !f) { desistir(); return avisar(userId, "Aviso.SemFechadura", {}, "warn"); }
    if (!estaTrancada(doc, f)) { desistir(); return avisar(userId, "Aviso.JaAberta"); }
    const problema = conferirPedido(doc, f, actor, user);
    if (problema) { desistir(); return avisar(userId, problema, {}, "warn"); }

    if (pedido.tipo === "testeDC") {
      // o teste "antes do minijogo" só serve onde há minijogo com teste antes; o teste para abrir, onde ele abre
      const prep = prepararArrombar(f, actor);
      if (prep.erro) { desistir(); return avisar(userId, prep.erro, {}, "warn"); }
      const permitido = pedido.finalidade === "minigame" ? aceitaMinijogo(f) && f.testeAntes : testeAbre(f);
      if (!permitido) { desistir(); return avisar(userId, "Aviso.SemTeste", {}, "warn"); }
      // a rolagem pode levar minutos: o mestre espera fora da fila e depois volta para decidir
      esperarTesteDC(pedido, userId, actor, prep.bonus, Number(f.cd)).catch(e => {
        console.error(`${ID} | Dados em Cena`, e);
        responder(userId, pedido.pedidoId, null);
      });
      return;
    }

    if (pedido.tipo === "iniciarJogo") return iniciarJogo(pedido, doc, f, actor, user, prepararArrombar(f, actor), desistir);

    if (pedido.tipo === "chave") {
      const item = await fromUuid(String(pedido.itemUuid ?? ""));
      const chave = lerChave(item);
      if (!item || !chave || !temEstoque(item) || item.parent?.uuid !== actor?.uuid) return avisar(userId, "Aviso.ChaveSumiu", {}, "warn");
      const r = chaveServe(chave, f);
      if (!r.serve) return avisar(userId, "Aviso.NaoServe", { chave: item.name }, "warn");
      const nomeChave = esc(item.name);
      if (r.porMestra) {
        const usados = (chave.usados ?? 0) + 1;
        if (chave.usosMax > 0 && usados >= chave.usosMax) {
          // a próxima chave da pilha começa nova
          await gastarItem(item, { [`flags.${ID}.chave.usados`]: 0 });
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
      const via = pedido.via === "minigame" ? "minigame" : "teste";
      // minijogo: a sessão acaba aqui, dê o resultado que der
      const sessao = via === "minigame" ? lerSessao(doc, userId) : null;
      if (sessao) await apagarSessao(doc, userId);
      const prep = prepararArrombar(f, actor);
      if (prep.erro) return avisar(userId, prep.erro, {}, "warn");
      // teste: só onde o teste abre, ou onde ele vem antes do minijogo (aí só a falha conta)
      if (via === "teste" && !testeAbre(f) && !(aceitaMinijogo(f) && f.testeAntes)) return avisar(userId, "Aviso.SemTeste", {}, "warn");
      let sucesso;
      if (via === "teste") {
        // o veredito sai da rolagem no chat, lida aqui no mestre
        const total = lerRolagem(pedido.mensagemId, user);
        if (total == null) return avisar(userId, "Aviso.SemRolagem", {}, "warn");
        sucesso = total + prep.bonus >= Number(f.cd);
        // passar no teste antes do minijogo não abre a fechadura: o jogador ainda precisa do minijogo
        if (sucesso && !testeAbre(f)) return avisar(userId, "Aviso.SemTeste", {}, "warn");
      } else {
        // minijogo: o mestre refaz as jogadas com a semente que ele mesmo sorteou
        if (!sessao || sessao.actorUuid !== actor.uuid) return avisar(userId, "Aviso.SemJogo", {}, "warn");
        sucesso = resultadoJogo(sessao, pedido.registro);
      }
      const como = t(via === "minigame" ? "Chat.ComGazua" : "Chat.ComTeste");
      if (sucesso) return destrancar(doc, { actor, userId, como });
      return falhar(doc, f, actor, userId, prep.gazua?.uuid, via);
    }
  } catch (e) {
    console.error(`${ID} | pedido`, pedido, e);
    if (pedido.tipo === "testeDC" || pedido.tipo === "iniciarJogo") responder(userId, pedido.pedidoId, false);
    avisar(userId, "Aviso.Erro", {}, "error");
  }
}

// ---------- Dados em Cena ----------

/** Espera a rolagem (fora da fila) e decide na fila, relendo a fechadura e o inventário. */
async function esperarTesteDC(pedido, userId, actor, bonus, cd) {
  const api = apiDados();
  let r = null;
  try {
    r = api && await api.pedirTeste({
      tokenId: pedido.tokenId, actorId: actor.id, sceneId: pedido.sceneId,
      config: { kind: "tool", toolKey: "thief", label: t("Teste.Ferramenta") },
      cd, modo: pedido.modo === "simples" ? "chat" : "tela",
      para: [userId], bonus, tempoLimite: 120000
    });
  } catch (e) { console.error(`${ID} | Dados em Cena`, e); }
  const total = Number.isFinite(Number(r?.total)) ? Number(r.total) : null;
  responder(userId, pedido.pedidoId, total);
  if (total == null) return;
  return emFila(async () => {
    const doc = await fromUuid(String(pedido.uuid ?? ""));
    const f = lerFechadura(doc);
    if (!f) return avisar(userId, "Aviso.SemFechadura", {}, "warn");
    if (!estaTrancada(doc, f)) return avisar(userId, "Aviso.JaAberta");
    const prep = prepararArrombar(f, actor);
    if (prep.erro) return avisar(userId, prep.erro, {}, "warn");
    if (total < Number(f.cd)) return falhar(doc, f, actor, userId, prep.gazua?.uuid, "teste");
    if (pedido.finalidade === "minigame") { liberados.set(`${userId}:${doc.uuid}`, { quando: Date.now(), total }); return; }
    if (!testeAbre(f)) return avisar(userId, "Aviso.SemTeste", {}, "warn");
    return destrancar(doc, { actor, userId, como: t("Chat.ComTeste") });
  });
}

// ---------- Minijogo ----------

/** Total do "teste antes" que o mestre aceita (Dados em Cena ou rolagem no chat); null se não há. */
function totalTesteAntes(pedido, doc, user, bonus) {
  const chave = `${user.id}:${doc.uuid}`;
  const lib = liberados.get(chave);
  liberados.delete(chave);
  if (lib && Date.now() - lib.quando <= VALIDADE) return lib.total;
  const total = lerRolagem(pedido.mensagemId, user);
  return total == null ? null : total + bonus;
}

/** Começa (ou retoma) o minijogo: sorteia a semente, grava a sessão e manda ao jogador. */
async function iniciarJogo(pedido, doc, f, actor, user, prep, desistir) {
  const userId = user.id;
  const nega = (chave, dados = {}) => { desistir(); return avisar(userId, chave, dados, "warn"); };
  if (prep.erro) return nega(prep.erro);
  if (f.modo !== "minigame" && f.modo !== "ambos") return nega("Aviso.SemMinijogo");

  // sessão anterior: válida → o mesmo jogo continua (mesma semente, mesmo relógio); vencida → falha
  const antiga = lerSessao(doc, userId);
  if (antiga) {
    if (Date.now() <= antiga.validade) {
      if (antiga.actorUuid !== actor.uuid) return nega("Aviso.JogoEmAndamento");
      agendarExpiracao(doc, userId, antiga);
      return responder(userId, pedido.pedidoId, {
        tipo: antiga.tipo, semente: antiga.semente, parametros: antiga.parametros,
        decorrido: (Date.now() - antiga.inicio) / 1000
      });
    }
    await expirar(doc, userId, antiga);
    return nega("Aviso.JogoExpirou");
  }

  // o teste antes: quem decide é o total que o mestre leu, e a margem dá tempo extra
  let margem = 0;
  if (f.testeAntes) {
    const total = totalTesteAntes(pedido, doc, user, prep.bonus);
    if (total == null && !user.isGM) return nega("Aviso.SemRolagem");
    if (total != null && total < Number(f.cd)) {
      desistir();
      return falhar(doc, f, actor, userId, prep.gazua?.uuid, "teste");
    }
    margem = total == null ? 0 : total - Number(f.cd);
  }

  const tipo = escolherJogo(f);
  const p = parametros(f, actor, { margem, bonusGazua: prep.bonus }, tipo);
  const agora = Date.now();
  const sessao = {
    actorUuid: actor.uuid, tipo, semente: novaSemente(), parametros: p, inicio: agora,
    validade: agora + Math.max(ESPERA_JOGO, (p.tempo > 0 ? p.tempo * 1000 : 0) + FOLGA)
  };
  await doc.setFlag(ID, `jogos.${userId}`, sessao);
  agendarExpiracao(doc, userId, sessao);
  responder(userId, pedido.pedidoId, { tipo, semente: sessao.semente, parametros: p, decorrido: 0 });
}

/** Refaz as jogadas recebidas com a semente da sessão e diz se a fechadura abriu. */
function resultadoJogo(sessao, registro) {
  const agora = Date.now();
  if (agora > sessao.validade) return false;
  const segundos = (agora - sessao.inicio) / 1000;
  const p = sessao.parametros ?? {};
  // o tempo do jogo conta do sorteio até o resultado chegar (com folga para a rede e a janela abrir)
  if (p.tempo > 0 && segundos > p.tempo + FOLGA / 1000) return false;
  return conferir(sessao.tipo, p, sessao.semente, registro, { segundos });
}
