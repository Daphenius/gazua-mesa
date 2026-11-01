// Gazua da Mesa — fechaduras, chaves com segredos, chaves mestras e minigame de gazua.

import {
  ID, SOCKET, TIPOS, t, cfg, lerFechadura, lerChave, estaTrancada, podeTerFechadura, chaveServe,
  regiaoContem, centroToken, lerGazua, limitePilha
} from "./dados.js";
import { aoReceber, destrancar, trancar, souMestreAtivo } from "./mestre.js";
import { abrirFechadura, abrirProximas, atualizarJanelas } from "./jogador.js";
import { configurarFechadura, configurarChave, removerFechadura, PainelFechaduras } from "./config.js";
import { JanelaMinijogos } from "./ajustes.js";

Hooks.once("init", () => {
  const reg = (nome, dados) => game.settings.register(ID, nome, {
    name: `GAZUAMESA.Opcao.${nome}.Nome`, hint: `GAZUAMESA.Opcao.${nome}.Dica`, ...dados
  });
  reg("anuncio", {
    scope: "world", config: true, type: String, default: "todos",
    choices: { todos: "GAZUAMESA.Opcao.anuncio.todos", mestre: "GAZUAMESA.Opcao.anuncio.mestre", nenhum: "GAZUAMESA.Opcao.anuncio.nenhum" }
  });
  reg("mostrarCD", { scope: "world", config: true, type: Boolean, default: false });
  reg("ferramentasContam", { scope: "world", config: true, type: Boolean, default: true });
  reg("gazuaEquipada", { scope: "world", config: true, type: Boolean, default: true });
  reg("limitePilha", { scope: "world", config: true, type: Number, default: 20, range: { min: 0, max: 100, step: 1 } });
  reg("quebraGazua", {
    scope: "world", config: true, type: String, default: "ambos",
    choices: {
      ambos: "GAZUAMESA.Opcao.quebraGazua.ambos",
      testes: "GAZUAMESA.Opcao.quebraGazua.testes",
      minijogos: "GAZUAMESA.Opcao.quebraGazua.minijogos",
      nunca: "GAZUAMESA.Opcao.quebraGazua.nunca"
    }
  });
  game.settings.register(ID, "minijogos", { scope: "world", config: false, type: Object, default: {} });
  game.settings.registerMenu(ID, "menuMinijogos", {
    name: "GAZUAMESA.Ajustes.Titulo", label: "GAZUAMESA.Ajustes.Abrir", hint: "GAZUAMESA.Ajustes.DicaMenu",
    icon: "fa-solid fa-puzzle-piece", type: JanelaMinijogos, restricted: true
  });
  reg("testeDadosEmCena", {
    scope: "world", config: true, type: String, default: "animada",
    choices: {
      animada: "GAZUAMESA.Opcao.testeDadosEmCena.animada",
      simples: "GAZUAMESA.Opcao.testeDadosEmCena.simples",
      desligado: "GAZUAMESA.Opcao.testeDadosEmCena.desligado"
    }
  });
  reg("cliquePorta", { scope: "world", config: true, type: Boolean, default: true });
  reg("entrarRegiao", { scope: "world", config: true, type: Boolean, default: true });
  reg("botaoHUD", { scope: "world", config: true, type: Boolean, default: true });

  // Clique do jogador numa porta trancada abre a janela da fechadura.
  // Só "escuta" o clique: não bloqueia o Foundry nem outros módulos (Arm's Reach, Objetos Vivos).
  // Com o libWrapper, usa o tipo LISTENER, que nunca gera aviso de conflito.
  const ALVO = "foundry.canvas.containers.DoorControl.prototype._onMouseDown";
  const ouvirClique = function () {
    try { interceptarPorta(this.wall?.document); } catch (e) { console.error(`${ID} | porta`, e); }
  };
  if (globalThis.libWrapper) {
    if ("LISTENER" in libWrapper) libWrapper.register(ID, ALVO, function (...args) { ouvirClique.call(this); }, libWrapper.LISTENER);
    else libWrapper.register(ID, ALVO, function (wrapped, ...args) { ouvirClique.call(this); return wrapped(...args); }, "WRAPPER");
  } else {
    const DC = foundry.canvas?.containers?.DoorControl;
    const original = DC?.prototype?._onMouseDown;
    if (typeof original === "function") {
      DC.prototype._onMouseDown = function (...args) { ouvirClique.call(this); return original.apply(this, args); };
    } else {
      console.warn(`${ID} | DoorControl não encontrado: o clique em portas trancadas fica sem a janela.`);
    }
  }
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, aoReceber);
  const mod = game.modules.get(ID);
  mod.api = {
    abrir: abrirFechadura,
    proximas: abrirProximas,
    configurar: configurarFechadura,
    configurarChave,
    remover: removerFechadura,
    painel: () => PainelFechaduras.abrir(),
    minijogos: () => new JanelaMinijogos().render({ force: true }),
    destrancar: doc => (souMestreAtivo() ? destrancar(doc) : null),
    trancar: doc => (souMestreAtivo() ? trancar(doc) : null),
    lerFechadura, lerChave, estaTrancada, chaveServe
  };
});

function interceptarPorta(wallDoc) {
  if (!wallDoc || game.user.isGM || !cfg("cliquePorta")) return false;
  if (!lerFechadura(wallDoc) || !estaTrancada(wallDoc)) return false;
  abrirFechadura(wallDoc);
  return true;
}

// ---------- Menus do mestre ----------

// Botão "Fechadura" no menu de cabeçalho das configurações (porta, token, tile,
// região, nota, diário, página) e "Chave" nas fichas de item.
Hooks.on("getHeaderControlsDocumentSheetV2", (app, controles) => {
  if (!game.user.isGM) return;
  const doc = app.document;
  if (!(doc instanceof foundry.abstract.Document) || !doc.id) return;
  if (podeTerFechadura(doc)) {
    controles.push({
      action: "gazua-mesaFechadura", icon: "fa-solid fa-lock", label: "GAZUAMESA.Menu.Fechadura",
      onClick: () => configurarFechadura(doc)
    });
  } else if (doc.documentName === "Item") {
    controles.push({
      action: "gazua-mesaChave", icon: "fa-solid fa-key", label: "GAZUAMESA.Menu.Chave",
      onClick: () => configurarChave(doc)
    });
  }
});

// Menu de contexto da barra lateral (Itens e Diários)
function entradaMenu(rotulo, icone, colecao, acao) {
  const pegar = li => {
    const el = li?.closest?.("[data-entry-id], [data-document-id]") ?? li;
    const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
    return id ? colecao().get(id) : null;
  };
  return {
    label: rotulo, icon: `<i class="fa-solid ${icone}"></i>`,
    visible: () => game.user.isGM,
    onClick: (ev, alvo) => { const d = pegar(alvo); if (d) acao(d); }
  };
}
Hooks.on("getItemContextOptions", (app, menu) => {
  menu.push(entradaMenu("GAZUAMESA.Menu.Chave", "fa-key", () => game.items, configurarChave));
});
Hooks.on("getJournalEntryContextOptions", (app, menu) => {
  menu.push(entradaMenu("GAZUAMESA.Menu.Fechadura", "fa-lock", () => game.journal, configurarFechadura));
});

// Botão no controle de tokens: painel com todas as fechaduras e chaves
Hooks.on("getSceneControlButtons", controles => {
  if (!game.user.isGM) return;
  const tokens = controles.tokens ?? controles.token;
  if (!tokens?.tools) return;
  tokens.tools["gazua-mesa"] = {
    name: "gazua-mesa", title: "GAZUAMESA.Painel.Titulo", icon: "fa-solid fa-key",
    order: Object.keys(tokens.tools).length, button: true, visible: true,
    onChange: () => PainelFechaduras.abrir()
  };
});

// ---------- Jogador ----------

// Botão no HUD do token: fechaduras ao alcance
Hooks.on("renderTokenHUD", (hud, html) => {
  if (!cfg("botaoHUD")) return;
  const token = hud.object;
  if (!token?.actor || !token.isOwner) return;
  const el = html instanceof HTMLElement ? html : html?.[0];
  const coluna = el?.querySelector(".col.right") ?? el?.querySelector(".col.left");
  if (!coluna) return;
  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "control-icon gazua-mesa-hud";
  botao.dataset.tooltip = t("HUD.Botao");
  botao.innerHTML = `<i class="fa-solid fa-key"></i>`;
  botao.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); abrirProximas(token); });
  coluna.appendChild(botao);
});

// Entrar numa região trancada (ex.: um portal) abre a janela da fechadura
Hooks.on("moveToken", (tokenDoc, movimento, operacao, usuario) => {
  if (!cfg("entrarRegiao") || game.user.isGM || usuario?.id !== game.user.id) return;
  const token = tokenDoc.object;
  if (!token?.actor || !token.isOwner) return;
  const p = centroToken(token);
  for (const regiao of tokenDoc.parent?.regions ?? []) {
    const f = lerFechadura(regiao);
    if (f && estaTrancada(regiao, f) && regiaoContem(regiao, p, tokenDoc.elevation)) {
      abrirFechadura(regiao, token);
      break;
    }
  }
});

// Nota (alfinete) com fechadura: em vez de abrir o diário, abre a fechadura
Hooks.on("activateNote", note => {
  if (game.user.isGM) return;
  const doc = note.document;
  if (lerFechadura(doc) && estaTrancada(doc)) {
    abrirFechadura(doc);
    return false;
  }
});

// ---------- Atualizar janelas abertas ----------

for (const tipo of [...TIPOS, "Item"]) {
  Hooks.on(`update${tipo}`, doc => atualizarJanelas(doc));
}
Hooks.on("createItem", doc => atualizarJanelas(doc));

// ---------- Pilhas de gazua ----------
// Uma pilha passa do limite (ex.: 20)? O excedente vira novas pilhas no mesmo inventário.
// Roda só no navegador de quem fez a mudança, para não dividir duas vezes.
async function dividirPilha(item, userId) {
  if (userId !== game.user.id || item.parent?.documentName !== "Actor" || !lerGazua(item)) return;
  const limite = limitePilha(item);
  const qtd = Number(item.system?.quantity) || 0;
  if (!(limite > 0) || qtd <= limite) return;
  const base = item.toObject();
  delete base._id;
  const novas = [];
  for (let resto = qtd - limite; resto > 0; resto -= limite) {
    const pilha = foundry.utils.deepClone(base);
    foundry.utils.setProperty(pilha, "system.quantity", Math.min(limite, resto));
    foundry.utils.setProperty(pilha, `flags.${ID}.gazua.usados`, 0);
    novas.push(pilha);
  }
  await item.update({ "system.quantity": limite }, { gazuaPilha: true });
  await item.parent.createEmbeddedDocuments("Item", novas, { gazuaPilha: true });
  ui.notifications.info(t("Aviso.PilhaDividida", { nome: item.name, limite, n: novas.length + 1 }));
}
Hooks.on("createItem", (item, opcoes, userId) => { if (!opcoes?.gazuaPilha) dividirPilha(item, userId); });
Hooks.on("updateItem", (item, mudou, opcoes, userId) => {
  if (!opcoes?.gazuaPilha && foundry.utils.hasProperty(mudou ?? {}, "system.quantity")) dividirPilha(item, userId);
});
Hooks.on("deleteItem", doc => atualizarJanelas(doc));
Hooks.on("controlToken", () => atualizarJanelas(null));

// Porta trancada pelo mestre no clique direito: a fechadura acompanha
Hooks.on("updateWall", (doc, mudou) => {
  if (!("ds" in (mudou ?? {})) || !souMestreAtivo()) return;
  const f = lerFechadura(doc);
  if (f && f.trancada !== estaTrancada(doc, f)) doc.setFlag(ID, "fechadura.trancada", estaTrancada(doc, f));
});

