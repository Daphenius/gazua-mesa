// Imitação mínima das partes do Foundry que dados.js, logica.js e mestre.js usam.
// Serve para testar as regras; não prova nada sobre o comportamento dentro do Foundry.
//
// Este arquivo precisa ser importado ANTES dos scripts do módulo: jogos.js e ajustes.js leem
// foundry.applications.api assim que são carregados.

import { readFileSync } from "node:fs";

const ID = "gazua-mesa";

function lerIdioma(lang) {
  const plano = {};
  const andar = (no, prefixo) => {
    for (const [k, v] of Object.entries(no)) {
      const chave = prefixo ? `${prefixo}.${k}` : k;
      if (v && typeof v === "object") andar(v, chave);
      else plano[chave] = v;
    }
  };
  andar(JSON.parse(readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), "utf8")), "");
  return plano;
}

// ---------- utilidades do foundry.utils ----------

const clonar = v => (v === undefined ? v : structuredClone(v));

function mesclar(alvo, origem) {
  for (const [k, v] of Object.entries(origem ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && alvo[k] && typeof alvo[k] === "object" && !Array.isArray(alvo[k])) mesclar(alvo[k], v);
    else alvo[k] = clonar(v);
  }
  return alvo;
}

function porCaminho(obj, caminho, valor) {
  const partes = caminho.split(".");
  const ultima = partes.pop();
  let o = obj;
  for (const p of partes) o = (o[p] ??= {});
  if (valor && typeof valor === "object" && !Array.isArray(valor) && o[ultima] && typeof o[ultima] === "object") mesclar(o[ultima], valor);
  else o[ultima] = clonar(valor);
}

function apagarCaminho(obj, caminho) {
  const partes = caminho.split(".");
  const ultima = partes.pop();
  let o = obj;
  for (const p of partes) { o = o?.[p]; if (!o) return; }
  delete o[ultima];
}

let contador = 0;
const novoId = () => `id${(++contador).toString().padStart(14, "0")}`;

class Colecao extends Map {
  *[Symbol.iterator]() { yield* this.values(); }
  get contents() { return [...this.values()]; }
  filter(fn) { return this.contents.filter(fn); }
  find(fn) { return this.contents.find(fn); }
  some(fn) { return this.contents.some(fn); }
  map(fn) { return this.contents.map(fn); }
}

class ApplicationV2 {
  constructor(options = {}) { this.options = options; }
  render() { return Promise.resolve(this); }
  close() { return Promise.resolve(); }
}

Math.clamp ??= (v, min, max) => Math.min(max, Math.max(min, v));

globalThis.foundry = {
  applications: {
    api: { ApplicationV2, DialogV2: class extends ApplicationV2 {} },
    ux: { TextEditor: { implementation: { enrichHTML: async html => html } } }
  },
  utils: {
    deepClone: clonar,
    mergeObject: (a, b, { inplace = true } = {}) => mesclar(inplace ? a : clonar(a), b),
    randomID: novoId
  },
  abstract: { Document: class {} }
};

globalThis.CONST = {
  WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 },
  WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 },
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }
};

globalThis.Hooks = { chamados: [], callAll(nome, ...args) { this.chamados.push(nome); } };

// ---------- Documentos ----------

class Doc {
  constructor(mundo, documentName, dados = {}, parent = null) {
    Object.assign(this, { id: novoId(), flags: {}, ...clonar(dados) });
    this.documentName = documentName;
    this.parent = parent;
    this._mundo = mundo;
    this.uuid = parent ? `${parent.uuid}.${documentName}.${this.id}` : `${documentName}.${this.id}`;
    mundo.porUuid.set(this.uuid, this);
  }

  async update(mudancas) {
    for (const [k, v] of Object.entries(mudancas)) porCaminho(this, k, v);
    this._mundo.atualizacoes.push([this.uuid, mudancas]);
    return this;
  }

  getFlag(escopo, chave) { return chave.split(".").reduce((o, p) => o?.[p], this.flags?.[escopo]); }
  setFlag(escopo, chave, valor) { return this.update({ [`flags.${escopo}.${chave}`]: valor }); }
  async unsetFlag(escopo, chave) {
    apagarCaminho(this.flags[escopo] ?? {}, chave);
    this._mundo.atualizacoes.push([this.uuid, { [`flags.${escopo}.-=${chave}`]: null }]);
    return this;
  }

  async delete() {
    this._mundo.porUuid.delete(this.uuid);
    this.parent?.items?.delete(this.id);
    this._mundo.apagados.push(this.uuid);
    return this;
  }
}

class Ator extends Doc {
  constructor(mundo, dados) {
    super(mundo, "Actor", dados);
    this.items = new Colecao();
    this.donos ??= [];
  }
  testUserPermission(user, nivel) { return nivel === "OWNER" && (user.isGM || this.donos.includes(user.id)); }
  getActiveTokens() { return []; }
}

// ---------- Mundo ----------

/**
 * Cria um mundo novo: o usuário atual é o mestre ativo ("mestre"), e há dois jogadores ("p1", "p2").
 * Opções: { lang, ajustes } — `ajustes` substitui as configurações do módulo.
 */
export function criarMundo({ lang = "pt-BR", ajustes = {} } = {}) {
  const textos = lerIdioma(lang);
  Hooks.chamados = [];
  const mundo = {
    porUuid: new Map(),
    atualizacoes: [],
    apagados: [],
    avisos: [],
    socket: [],
    chat: [],
    cena: null
  };

  const config = {
    anuncio: "todos", mostrarCD: false, ferramentasContam: true, gazuaEquipada: true,
    quebraGazua: "ambos", minijogos: {}, testeDadosEmCena: "desligado",
    cliquePorta: true, entrarRegiao: true, botaoHUD: true, ...ajustes
  };

  const users = new Colecao();
  for (const [id, isGM] of [["mestre", true], ["p1", false], ["p2", false]]) users.set(id, { id, isGM, name: id });
  users.activeGM = users.get("mestre");
  const messages = new Colecao();

  globalThis.game = {
    i18n: {
      lang,
      localize: k => textos[k] ?? k,
      format: (k, dados) => (textos[k] ?? k).replace(/{(\w+)}/g, (m, n) => dados?.[n] ?? m)
    },
    user: users.get("mestre"),
    users,
    messages,
    modules: new Map(),
    scenes: new Colecao(),
    journal: new Colecao(),
    actors: new Colecao(),
    documentTypes: { Item: ["base", "weapon", "tool", "loot"] },
    settings: {
      get: (escopo, chave) => clonar(config[chave]),
      set: async (escopo, chave, valor) => { config[chave] = clonar(valor); return valor; }
    },
    socket: { emit: (canal, msg) => mundo.socket.push(clonar(msg)) }
  };

  globalThis.ui = {
    notifications: {
      info: m => mundo.avisos.push(["info", m]),
      warn: m => mundo.avisos.push(["warn", m]),
      error: m => mundo.avisos.push(["error", m])
    }
  };

  globalThis.ChatMessage = {
    create: async dados => { mundo.chat.push(dados); return dados; },
    getSpeaker: ({ actor } = {}) => ({ alias: actor?.name }),
    getWhisperRecipients: () => [users.get("mestre")]
  };

  globalThis.fromUuid = async uuid => mundo.porUuid.get(uuid) ?? null;
  globalThis.canvas = null;

  // ---------- fábricas ----------

  mundo.criarCena = () => {
    const cena = new Doc(mundo, "Scene", { grid: { size: 100 } });
    for (const c of ["walls", "tokens", "tiles", "notes", "regions"]) cena[c] = new Colecao();
    game.scenes.set(cena.id, cena);
    mundo.cena = cena;
    return cena;
  };

  /** Personagem de um jogador, com token na cena em (x, y) casas. */
  mundo.criarAtor = ({ nome = "Ladina", dono = "p1", x = 0, y = 0, des = 4, prof = 3, thief = 1 } = {}) => {
    const actor = new Ator(mundo, {
      name: nome, donos: dono ? [dono] : [],
      system: { abilities: { dex: { mod: des } }, attributes: { prof }, tools: { thief: { value: thief } } }
    });
    game.actors.set(actor.id, actor);
    if (mundo.cena) {
      const token = new Doc(mundo, "Token", { x: x * 100, y: y * 100, width: 1, height: 1, elevation: 0, flags: {} }, mundo.cena);
      token.actor = actor;
      mundo.cena.tokens.set(token.id, token);
    }
    return actor;
  };

  /** Item no inventário do ator. */
  mundo.criarItem = (actor, dados) => {
    const item = new Doc(mundo, "Item", { system: { quantity: 1 }, ...dados }, actor);
    actor.items.set(item.id, item);
    return item;
  };

  /** Gazua marcada pelo mestre, equipada. */
  mundo.criarGazua = (actor, { bonus = 0, usosMax = 1, quantidade = 1, usos = null } = {}) => mundo.criarItem(actor, {
    name: "Gazua", type: "tool",
    system: { quantity: quantidade, equipped: true, ...(usos ? { uses: { max: usos, spent: 0 } } : {}) },
    flags: { [ID]: { gazua: { ativa: true, bonus, usosMax, usados: 0 } } }
  });

  /** Porta trancada na casa (x, y). */
  mundo.criarPorta = (fechadura = {}, { x = 1, y = 0 } = {}) => {
    const c = [x * 100, y * 100, x * 100, (y + 1) * 100];
    const porta = new Doc(mundo, "Wall", {
      door: CONST.WALL_DOOR_TYPES.DOOR, ds: CONST.WALL_DOOR_STATES.LOCKED, c,
      flags: { [ID]: { fechadura: { ativa: true, trancada: true, ...fechadura } } }
    }, mundo.cena);
    mundo.cena.walls.set(porta.id, porta);
    return porta;
  };

  /** Baú (token) com fechadura. */
  mundo.criarBau = (fechadura = {}, { x = 1, y = 0 } = {}) => {
    const bau = new Doc(mundo, "Token", {
      x: x * 100, y: y * 100, width: 1, height: 1, hidden: false,
      flags: { [ID]: { fechadura: { ativa: true, trancada: true, ...fechadura } } }
    }, mundo.cena);
    mundo.cena.tokens.set(bau.id, bau);
    return bau;
  };

  /** Diário com fechadura. */
  mundo.criarDiario = (fechadura = {}) => {
    const diario = new Doc(mundo, "JournalEntry", {
      name: "Diário", ownership: {}, pages: new Colecao(),
      flags: { [ID]: { fechadura: { ativa: true, trancada: true, ...fechadura } } }
    });
    game.journal.set(diario.id, diario);
    return diario;
  };

  /** Rolagem de Ferramentas de Ladrão no chat, feita pelo usuário. */
  mundo.criarRolagem = (userId, total, { timestamp = Date.now() } = {}) => {
    const id = novoId();
    messages.set(id, { id, author: users.get(userId), timestamp, rolls: [{ total }] });
    return id;
  };

  /** Mensagens de socket mandadas a um usuário (respostas e avisos). */
  mundo.paraUsuario = userId => mundo.socket.filter(m => m.para === userId || m.para?.includes?.(userId));
  mundo.chavesDeAviso = userId => mundo.paraUsuario(userId).filter(m => m.tipo === "aviso").map(m => m.chave);

  return mundo;
}
