// Gazua da Mesa — dados: leitura das fechaduras e chaves, segredos, distância.

export const ID = "gazua-mesa";
export const SOCKET = `module.${ID}`;

// Documentos que podem receber uma fechadura
export const TIPOS = ["Wall", "Token", "Tile", "Region", "Note", "JournalEntry", "JournalEntryPage"];
// Fechaduras sem lugar no mapa (abrem de qualquer distância, só com chave)
export const REMOTOS = ["JournalEntry", "JournalEntryPage"];

export const PADRAO_FECHADURA = {
  ativa: true,
  nome: "",
  trancada: true,
  nivel: 1,
  segredos: "",
  modo: "ambos",          // ambos | minigame | teste | chave
  cd: 15,
  exigeFerramentas: true,
  aceitaMestra: true,
  tentativas: 0,          // falhas permitidas por personagem (0 = sem limite)
  alcance: 1,             // em casas
  abrirPorta: false,      // portas: abrir direto em vez de só destrancar
  visibilidade: "nada",   // tiles/tokens: nada | mostrar | esconder
  permissao: "dono",      // tokens/diários: nenhuma | observador | dono
  paraTodos: false,       // permissão para todos os jogadores, não só quem abriu
  gatilho: true,          // ligar/desligar o gatilho do Navegador de Mapas junto
  journal: "",            // diário ou página revelado ao destrancar
  macro: "",              // macro executada pelo mestre ao destrancar
  mensagem: "",           // texto no chat ao destrancar
  falhas: {},             // { actorId: n }
  desativados: []         // regiões: comportamentos desligados pela fechadura
};

export const PADRAO_CHAVE = {
  ativa: true,
  segredos: "",
  mestra: false,
  nivelMax: 0,            // mestra: abre fechaduras até este nível (0 = qualquer)
  usosMax: 0,             // mestra: usos antes de se desgastar (0 = sem limite)
  usados: 0
};

export const t = (chave, dados) => dados
  ? game.i18n.format(`GAZUAMESA.${chave}`, dados)
  : game.i18n.localize(`GAZUAMESA.${chave}`);

export function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const cfg = chave => game.settings.get(ID, chave);

export function podeTerFechadura(doc) {
  if (!doc || !TIPOS.includes(doc.documentName) || !doc.id) return false;
  if (doc.documentName === "Wall") return Number(doc.door) > 0;
  return true;
}

export function lerFechadura(doc) {
  const bruto = doc?.flags?.[ID]?.fechadura;
  if (!bruto || bruto.ativa === false) return null;
  return foundry.utils.mergeObject(foundry.utils.deepClone(PADRAO_FECHADURA), bruto, { inplace: false });
}

export function lerChave(item) {
  const bruto = item?.flags?.[ID]?.chave;
  if (!bruto || bruto.ativa === false) return null;
  return foundry.utils.mergeObject(foundry.utils.deepClone(PADRAO_CHAVE), bruto, { inplace: false });
}

export function estaTrancada(doc, f = lerFechadura(doc)) {
  if (!f) return false;
  if (doc.documentName === "Wall") return doc.ds === CONST.WALL_DOOR_STATES.LOCKED;
  return !!f.trancada;
}

export function segredos(texto) {
  return String(texto ?? "").split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function gerarSegredo() {
  const a = ["ferro", "prata", "corvo", "cripta", "rubi", "lua", "osso", "cinza", "nevoa", "torre", "serpente", "ambar"];
  const p = a[Math.floor(Math.random() * a.length)];
  return `${p}-${foundry.utils.randomID(4).toLowerCase()}`;
}

/** A chave abre a fechadura? Devolve { serve, porMestra }. */
export function chaveServe(chave, f) {
  if (!chave || !f) return { serve: false, porMestra: false };
  if (chave.mestra && chave.usosMax > 0 && chave.usados >= chave.usosMax) return { serve: false, porMestra: false };
  const daFechadura = new Set(segredos(f.segredos));
  if (segredos(chave.segredos).some(s => daFechadura.has(s))) return { serve: true, porMestra: !!chave.mestra };
  if (chave.mestra && f.aceitaMestra && (!(chave.nivelMax > 0) || f.nivel <= chave.nivelMax)) {
    return { serve: true, porMestra: true };
  }
  return { serve: false, porMestra: false };
}

export function nomeFechadura(doc, f = lerFechadura(doc)) {
  if (f?.nome) return f.nome;
  const proprio = doc.documentName === "Note" ? (doc.text || doc.entry?.name) : doc.name;
  return proprio || t(`Tipo.${doc.documentName}`);
}

export function iconeTipo(nome) {
  return {
    Wall: "fa-door-closed", Token: "fa-box-archive", Tile: "fa-cube", Region: "fa-dungeon",
    Note: "fa-map-pin", JournalEntry: "fa-book", JournalEntryPage: "fa-scroll", Item: "fa-key"
  }[nome] ?? "fa-lock";
}

export function chavesDoAtor(actor) {
  return (actor?.items?.contents ?? []).filter(i => lerChave(i));
}

export function ferramentasLadrao(actor) {
  return (actor?.items?.contents ?? []).find(i => i.type === "tool"
    && (i.system?.type?.baseItem === "thief" || /thie|ladr/i.test(i.name)));
}

/** Bônus de arrombar (Destreza + proficiência em ferramentas de ladrão, se houver). */
export function bonusArrombar(actor) {
  const sys = actor?.system ?? {};
  const des = Number(sys.abilities?.dex?.mod) || 0;
  const mult = Number(sys.tools?.thief?.value) || 0;
  const prof = Number(sys.attributes?.prof) || 0;
  return { total: des + Math.floor(prof * mult), mult };
}

// ---------- Mapa ----------

function retanguloRegiao(doc) {
  const b = doc.object?.bounds;
  if (b && Number.isFinite(b.width)) return { x: b.x, y: b.y, w: b.width, h: b.height };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pt = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const s of doc.shapes ?? []) {
    if (s.type === "rectangle") { pt(s.x, s.y); pt(s.x + s.width, s.y + s.height); }
    else if (s.type === "circle") { pt(s.x - s.radius, s.y - s.radius); pt(s.x + s.radius, s.y + s.radius); }
    else if (s.type === "ellipse") { pt(s.x - s.radiusX, s.y - s.radiusY); pt(s.x + s.radiusX, s.y + s.radiusY); }
    else if (Array.isArray(s.points)) for (let i = 0; i < s.points.length; i += 2) pt(s.points[i], s.points[i + 1]);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export function centroDoc(doc) {
  const gs = doc.parent?.grid?.size ?? canvas?.grid?.size ?? 100;
  switch (doc.documentName) {
    case "Wall": { const [x1, y1, x2, y2] = doc.c; return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }; }
    case "Token": return doc.object?.center ?? { x: doc.x + doc.width * gs / 2, y: doc.y + doc.height * gs / 2 };
    case "Tile": return { x: doc.x + doc.width / 2, y: doc.y + doc.height / 2 };
    case "Note": return { x: doc.x, y: doc.y };
    case "Region": { const r = retanguloRegiao(doc); return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null; }
    default: return null;
  }
}

export function centroToken(token) {
  const d = token.document ?? token;
  const gs = d.parent?.grid?.size ?? canvas?.grid?.size ?? 100;
  return token.center ?? { x: d.x + d.width * gs / 2, y: d.y + d.height * gs / 2 };
}

/** Região contém o ponto? */
export function regiaoContem(doc, p, elevacao = 0) {
  try {
    if (typeof doc.testPoint === "function") return !!doc.testPoint({ x: p.x, y: p.y, elevation: elevacao }, elevacao);
  } catch { /* cai no retângulo */ }
  const r = retanguloRegiao(doc);
  return !!r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Distância em casas entre o token e a fechadura (Infinity se não está no mesmo mapa). */
export function distanciaCasas(token, doc) {
  if (REMOTOS.includes(doc.documentName)) return 0;
  const tdoc = token?.document ?? token;
  if (!tdoc || doc.parent !== tdoc.parent) return Infinity;
  const gs = tdoc.parent?.grid?.size ?? 100;
  const p = centroToken(token);
  let alvo = centroDoc(doc);
  if (doc.documentName === "Region") {
    if (regiaoContem(doc, p, tdoc.elevation)) return 0;
    const r = retanguloRegiao(doc);
    if (r) alvo = { x: Math.clamp(p.x, r.x, r.x + r.w), y: Math.clamp(p.y, r.y, r.y + r.h) };
  }
  if (!alvo) return Infinity;
  // o tamanho do token conta: a distância é medida a partir da borda dele
  const raio = Math.max(tdoc.width, tdoc.height) / 2 - 0.5;
  return Math.max(0, Math.hypot(alvo.x - p.x, alvo.y - p.y) / gs - raio);
}

export function aoAlcance(token, doc, f = lerFechadura(doc)) {
  if (!f) return false;
  // meia casa de folga: o token encostado na porta ou no baú já alcança
  return distanciaCasas(token, doc) <= (Number(f.alcance) || 1) + 0.5;
}

/** Token que o usuário está usando para interagir. */
export function tokenDoUsuario() {
  const cena = canvas?.tokens?.placeables ?? [];
  const controlado = canvas?.tokens?.controlled?.find(t => t.actor && t.isOwner);
  if (controlado) return controlado;
  if (game.user.isGM) return null;
  const meu = game.user.character && cena.find(t => t.actor?.id === game.user.character.id);
  return meu ?? cena.find(t => t.actor && t.isOwner && !t.document.hidden) ?? null;
}

/** Todas as fechaduras do mapa e dos diários. */
export function todasFechaduras(cena = canvas?.scene) {
  const docs = [];
  if (cena) {
    for (const col of [cena.walls, cena.tokens, cena.tiles, cena.notes, cena.regions]) {
      for (const d of col ?? []) if (lerFechadura(d) && podeTerFechadura(d)) docs.push(d);
    }
  }
  for (const j of game.journal ?? []) {
    if (lerFechadura(j)) docs.push(j);
    for (const p of j.pages ?? []) if (lerFechadura(p)) docs.push(p);
  }
  return docs;
}
