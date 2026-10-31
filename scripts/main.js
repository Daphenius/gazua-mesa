// Gazua da Mesa — fechaduras, chaves com segredos, chaves mestras e minigame de gazua.

import {
  ID, SOCKET, TIPOS, t, cfg, lerFechadura, lerChave, estaTrancada, podeTerFechadura, chaveServe,
  regiaoContem, centroToken
} from "./dados.js";
import { aoReceber, destrancar, trancar, souMestreAtivo } from "./mestre.js";
import { abrirFechadura, abrirProximas, atualizarJanelas } from "./jogador.js";
import { configurarFechadura, configurarChave, removerFechadura, PainelFechaduras } from "./config.js";

Hooks.once("init", () => {
  const reg = (nome, dados) => game.settings.register(ID, nome, {
    name: `GAZUAMESA.Opcao.${nome}.Nome`, hint: `GAZUAMESA.Opcao.${nome}.Dica`, ...dados
  });
  reg("anuncio", {
    scope: "world", config: true, type: String, default: "todos",
    choices: { todos: "GAZUAMESA.Opcao.anuncio.todos", mestre: "GAZUAMESA.Opcao.anuncio.mestre", nenhum: "GAZUAMESA.Opcao.anuncio.nenhum" }
  });
  reg("mostrarCD", { scope: "world", config: true, type: Boolean, default: false });
  reg("cliquePorta", { scope: "world", config: true, type: Boolean, default: true });
  reg("entrarRegiao", { scope: "world", config: true, type: Boolean, default: true });
  reg("botaoHUD", { scope: "world", config: true, type: Boolean, default: true });

  // Clique do jogador numa porta trancada abre a janela da fechadura
  const DC = foundry.canvas?.containers?.DoorControl;
  const original = DC?.prototype?._onMouseDown;
  if (typeof original === "function") {
    DC.prototype._onMouseDown = function (event) {
      try {
        if (interceptarPorta(this.wall?.document)) {
          event?.stopPropagation?.();
          return false;
        }
      } catch (e) { console.error(`${ID} | porta`, e); }
      return original.call(this, event);
    };
  } else {
    console.warn(`${ID} | DoorControl não encontrado: o clique em portas trancadas fica sem a janela.`);
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
Hooks.on("deleteItem", doc => atualizarJanelas(doc));
Hooks.on("controlToken", () => atualizarJanelas(null));

// Porta trancada pelo mestre no clique direito: a fechadura acompanha
Hooks.on("updateWall", (doc, mudou) => {
  if (!("ds" in (mudou ?? {})) || !souMestreAtivo()) return;
  const f = lerFechadura(doc);
  if (f && f.trancada !== estaTrancada(doc, f)) doc.setFlag(ID, "fechadura.trancada", estaTrancada(doc, f));
});

