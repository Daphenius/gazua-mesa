// Gazua da Mesa — telas do mestre: configurar fechadura, configurar chave e o painel da cena.

import {
  ID, t, esc, PADRAO_FECHADURA, PADRAO_CHAVE, PADRAO_GAZUA, lerFechadura, lerChave, lerGazua, estaTrancada, podeTerFechadura,
  nomeFechadura, iconeTipo, gerarSegredo, segredos, todasFechaduras, centroDoc, REMOTOS
} from "./dados.js";
import { sincronizar, destrancar, trancar } from "./mestre.js";
import { abrirFechadura } from "./jogador.js";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

// ---------- utilidades de formulário ----------

function lerForm(form) {
  const dados = {};
  for (const el of form?.elements ?? []) {
    if (!el.name) continue;
    if (el.type === "checkbox") dados[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) dados[el.name] = el.value; }
    else if (el.type === "number" || el.type === "range") dados[el.name] = Number(el.value) || 0;
    else dados[el.name] = el.value.trim();
  }
  return dados;
}

const opcoes = (lista, atual, prefixo) => lista.map(v =>
  `<option value="${v}" ${v === atual ? "selected" : ""}>${t(`${prefixo}.${v}`)}</option>`).join("");

const marcado = v => (v ? "checked" : "");

/** Linha de formulário: rótulo à esquerda, campo à direita, dica embaixo. */
function linha(rotulo, html, dica = "") {
  return `<div class="lp-linha"><label>${rotulo}</label><div class="lp-campo">${html}</div>${dica ? `<p class="lp-dica">${dica}</p>` : ""}</div>`;
}

/** Interruptor (liga/desliga) com título e explicação. */
function interruptor(nome, ligado, rotulo, dica = "") {
  return `<label class="lp-interruptor">
      <span class="lp-txt"><b>${rotulo}</b>${dica ? `<small>${dica}</small>` : ""}</span>
      <input type="checkbox" name="${nome}" ${marcado(ligado)}><span class="lp-trilho"></span>
    </label>`;
}

function secao(icone, titulo, corpo, classe = "") {
  return `<section class="lp-secao ${classe}"><h3><i class="fa-solid ${icone}"></i> ${titulo}</h3>${corpo}</section>`;
}

/** Aceita arrastar um diário/página/macro para um campo de UUID. */
function aceitarArraste(raiz) {
  for (const input of raiz.querySelectorAll("input[data-uuid]")) {
    input.addEventListener("dragover", ev => ev.preventDefault());
    input.addEventListener("drop", ev => {
      ev.preventDefault();
      try {
        const d = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (d?.uuid) input.value = d.uuid;
      } catch { /* não era um documento */ }
    });
  }
}

const elementoDo = (a, b) => (b ?? a)?.element ?? a?.target?.element ?? null;

async function criarChaveItem({ nome, segredo, mestra = false }) {
  const tipos = game.documentTypes?.Item ?? Object.keys(CONFIG.Item.dataModels ?? {});
  const type = tipos.includes("loot") ? "loot" : (tipos.find(x => x !== "base") ?? "base");
  const item = await Item.implementation.create({
    name: nome,
    type,
    img: "icons/sundries/misc/key-steel.webp",
    flags: { [ID]: { chave: { ...PADRAO_CHAVE, segredos: segredo, mestra } } }
  });
  ui.notifications.info(t("Config.ChaveCriada", { nome }));
  item?.sheet?.render(true);
  return item;
}

/** Faz um item qualquer virar chave com este segredo (somando aos segredos que já tiver). */
async function tornarChave(item, segredo) {
  const atual = lerChave(item);
  const lista = new Set([...segredos(atual?.segredos), segredo]);
  const chave = { ...(atual ?? PADRAO_CHAVE), ativa: true, segredos: [...lista].join(", ") };
  await item.update({ [`flags.${ID}.chave`]: chave });
}

/** Itens (na aba de Itens e com os personagens) que têm um dos segredos. */
function chavesComSegredo(texto) {
  const alvo = new Set(segredos(texto));
  if (!alvo.size) return [];
  const itens = [...(game.items?.contents ?? [])];
  for (const a of game.actors?.contents ?? []) itens.push(...(a.items?.contents ?? []));
  return itens.filter(i => segredos(lerChave(i)?.segredos).some(s => alvo.has(s)));
}

function listaChaves(texto) {
  const itens = chavesComSegredo(texto);
  if (!itens.length) return `<li class="lp-vazio">${t("Config.NenhumaChave")}</li>`;
  return itens.map(i => `<li data-uuid="${i.uuid}"><img src="${esc(i.img)}" alt=""><span class="lp-nome">${esc(i.name)}
    <em>${i.parent ? t("Config.ComPersonagem", { nome: esc(i.parent.name) }) : t("Config.NaAbaItens")}</em></span>
    <a class="lp-acao-chave" data-lp="desvincular" data-tooltip="${esc(t("Config.Desvincular"))}"><i class="fa-solid fa-link-slash"></i></a>
    <a class="lp-acao-chave lp-perigo" data-lp="excluirItem" data-tooltip="${esc(t("Config.ExcluirItem"))}"><i class="fa-solid fa-trash"></i></a></li>`).join("");
}

/** Tira estes segredos do item; sem segredo nenhum, ele volta a ser um item comum. */
export async function desvincularChave(item, texto) {
  const c = lerChave(item);
  if (!c) return;
  const tirar = new Set(segredos(texto));
  const resto = segredos(c.segredos).filter(s => !tirar.has(s));
  if (!resto.length && !c.mestra) return item.unsetFlag(ID, "chave");
  await item.update({ [`flags.${ID}.chave.segredos`]: resto.join(", ") });
}

// ---------- Fechadura ----------

const MODOS = [
  { v: "chave", icone: "fa-key" },
  { v: "teste", icone: "fa-dice-d20" },
  { v: "minigame", icone: "fa-unlock-keyhole" },
  { v: "ambos", icone: "fa-shuffle" }
];

export async function configurarFechadura(doc) {
  if (!game.user.isGM || !podeTerFechadura(doc)) return;
  const existe = !!doc.flags?.[ID]?.fechadura;
  const f = lerFechadura(doc) ?? foundry.utils.deepClone(PADRAO_FECHADURA);
  const tipo = doc.documentName;
  const trancada = existe ? estaTrancada(doc, f) : true;
  const temGatilho = !!doc.flags?.["navegador-mapas"]?.gatilho;
  const remoto = REMOTOS.includes(tipo);
  const modo = remoto ? "chave" : f.modo;

  // Cabeçalho: o que é, o nome e o interruptor de trancada
  const topo = `
    <div class="lp-cabeca">
      <div class="lp-icone"><i class="fa-solid ${iconeTipo(tipo)}"></i></div>
      <div class="lp-cabeca-txt">
        <small>${t(`Tipo.${tipo}`)}</small>
        <input type="text" name="nome" value="${esc(f.nome)}" placeholder="${esc(nomeFechadura(doc, { nome: "" }))}">
      </div>
      <label class="lp-interruptor lp-trancada" data-tooltip="${esc(t("Config.TrancadaDica"))}">
        <span class="lp-txt"><b>${t("Config.Trancada")}</b></span>
        <input type="checkbox" name="trancada" ${marcado(trancada)}><span class="lp-trilho"></span>
      </label>
    </div>`;

  // Como abrir sem a chave: cartões
  const cartoes = MODOS.map(m => `
    <label class="lp-modo" data-modo="${m.v}">
      <input type="radio" name="modo" value="${m.v}" ${m.v === modo ? "checked" : ""}>
      <i class="fa-solid ${m.icone}"></i>
      <b>${t(`Config.Modos.${m.v}`)}</b>
      <small>${t(`Config.ModosDica.${m.v}`)}</small>
    </label>`).join("");

  const jogos = [
    { v: "aleatorio", icone: "fa-shuffle" },
    { v: "discos", icone: "fa-circle-notch" },
    { v: "runas", icone: "fa-hat-wizard" },
    { v: "labirinto", icone: "fa-bolt" },
    { v: "sigilo", icone: "fa-pen-nib" },
    { v: "cristais", icone: "fa-gem" },
    { v: "canalizar", icone: "fa-wand-magic-sparkles" }
  ].map(j => `
    <label class="lp-modo lp-jogo-op">
      <input type="radio" name="minijogo" value="${j.v}" ${j.v === (f.minijogo || "aleatorio") ? "checked" : ""}>
      <i class="fa-solid ${j.icone}"></i>
      <b>${t(j.v === "aleatorio" ? "Config.JogoAleatorio" : `Jogo.${j.v}.Nome`)}</b>
      <small>${t(j.v === "aleatorio" ? "Config.JogoAleatorioDica" : `Jogo.${j.v}.Resumo`)}</small>
    </label>`).join("");

  const arrombar = `
    ${linha(t("Config.CD"), `<input type="number" name="cd" min="1" max="40" value="${f.cd}">`, t("Config.CDDica"))}
    ${interruptor("exigeFerramentas", f.exigeFerramentas, t("Config.Ferramentas"), t("Config.FerramentasDica"))}
    ${linha(t("Config.Tentativas"), `<input type="number" name="tentativas" min="0" value="${f.tentativas}">
      <label class="lp-inline"><input type="checkbox" name="zerarFalhas"> ${t("Config.ZerarFalhas")}</label>`, t("Config.TentativasDica"))}
    ${linha(t("Config.Alcance"), `<input type="number" name="alcance" min="0" step="0.5" value="${f.alcance}">`, t("Config.AlcanceDica"))}`;

  const minijogo = `
    <div class="lp-modos">${jogos}</div>
    ${linha(t("Config.Tempo"), `<input type="number" name="tempo" min="0" step="5" value="${f.tempo}"> <span class="lp-unid">s</span>`, t("Config.TempoDica"))}
    ${interruptor("testeAntes", f.testeAntes, t("Config.TesteAntes"), t("Config.TesteAntesDica"))}`;

  const chaves = `
    ${linha(t("Config.Segredos"), `<input type="text" name="segredos" value="${esc(f.segredos)}" placeholder="${esc(t("Config.SegredosExemplo"))}">
      <button type="button" class="lp-mini" data-lp="gerar" data-tooltip="${esc(t("Config.Gerar"))}"><i class="fa-solid fa-dice"></i></button>`, t("Config.SegredosDica"))}
    ${interruptor("aceitaMestra", f.aceitaMestra, t("Config.Mestra"), t("Config.MestraDica"))}
    <div class="lp-soltar" data-lp="soltar"><i class="fa-solid fa-hand-holding"></i> ${t("Config.SoltarChave")}</div>
    <ul class="lp-lista lp-chaves-da">${listaChaves(f.segredos)}</ul>
    <button type="button" class="lp-largo" data-lp="criarChave"><i class="fa-solid fa-key"></i> ${t("Config.CriarChave")}</button>`;

  let efeitos = "";
  if (tipo === "Wall") efeitos += interruptor("abrirPorta", f.abrirPorta, t("Config.AbrirPorta"), t("Config.AbrirPortaDica"));
  if (["Tile", "Token"].includes(tipo)) {
    efeitos += linha(t("Config.Visibilidade"), `<select name="visibilidade">${opcoes(["nada", "mostrar", "esconder"], f.visibilidade, "Config.Vis")}</select>`, t("Config.VisibilidadeDica"));
  }
  if (["Token", "JournalEntry", "JournalEntryPage"].includes(tipo)) {
    efeitos += linha(t("Config.Permissao"), `<select name="permissao">${opcoes(["nenhuma", "observador", "dono"], f.permissao, "Config.Perm")}</select>`,
      t(tipo === "Token" ? "Config.PermissaoDicaToken" : "Config.PermissaoDicaDiario"));
  }
  efeitos += interruptor("paraTodos", f.paraTodos, t("Config.ParaTodos"), t("Config.ParaTodosDica"));
  if (temGatilho) efeitos += interruptor("gatilho", f.gatilho, t("Config.Gatilho"), t("Config.GatilhoDica"));
  efeitos += linha(t("Config.Journal"), `<input type="text" name="journal" data-uuid value="${esc(f.journal)}" placeholder="${esc(t("Config.ArrasteAqui"))}">`, t("Config.JournalDica"));
  efeitos += linha(t("Config.Macro"), `<input type="text" name="macro" data-uuid value="${esc(f.macro)}" placeholder="${esc(t("Config.ArrasteAqui"))}">`, t("Config.MacroDica"));
  efeitos += linha(t("Config.Mensagem"), `<textarea name="mensagem" rows="2" placeholder="${esc(t("Config.MensagemExemplo"))}">${esc(f.mensagem)}</textarea>`);

  const content = `
    <div class="gazua-mesa lp-config">
      ${topo}
      ${remoto ? `<p class="lp-aviso"><i class="fa-solid fa-circle-info"></i> ${t("Config.SoChaveRemoto")}</p>`
        : secao("fa-door-open", t("Config.SemChave"), `<div class="lp-modos">${cartoes}</div>
          ${linha(t("Config.Nivel"), `<input type="range" name="nivel" min="1" max="10" step="1" value="${f.nivel}"><output class="lp-nivel-saida"></output>`, t("Config.NivelDica"))}`)}
      ${remoto ? "" : secao("fa-screwdriver", t("Config.Arrombar"), arrombar, "lp-sec-arrombar")}
      ${remoto ? "" : secao("fa-puzzle-piece", t("Config.Minijogo"), minijogo, "lp-sec-jogo")}
      ${secao("fa-key", t("Config.ChavesSecao"), chaves)}
      <details class="lp-secao lp-efeitos" ${f.journal || f.macro || f.mensagem ? "open" : ""}>
        <summary><i class="fa-solid fa-wand-magic-sparkles"></i> ${t("Config.AoDestrancar")}</summary>
        ${efeitos}
      </details>
    </div>`;

  const buttons = [
    { action: "salvar", label: t("Config.Salvar"), icon: "fa-solid fa-floppy-disk", default: true, callback: (ev, botao) => lerForm(botao.form) }
  ];
  if (existe) buttons.push({ action: "remover", label: t("Config.Remover"), icon: "fa-solid fa-trash" });
  buttons.push({ action: "cancelar", label: t("Config.Cancelar"), icon: "fa-solid fa-xmark" });

  const r = await DialogV2.wait({
    window: { title: t("Config.TituloFechadura"), icon: "fa-solid fa-lock" },
    position: { width: 560 },
    classes: ["gazua-mesa", "lp-dialogo"],
    content,
    buttons,
    rejectClose: false,
    render: (a, b) => {
      const el = elementoDo(a, b);
      if (!el) return;
      aceitarArraste(el);

      // nível: mostra quantos pinos o minigame terá
      const nivel = el.querySelector("input[name=nivel]");
      const saida = el.querySelector(".lp-nivel-saida");
      const mostrarNivel = () => {
        if (!nivel || !saida) return;
        const n = Number(nivel.value);
        saida.textContent = t("Config.NivelSaida", { n });
      };
      nivel?.addEventListener("input", mostrarNivel);
      mostrarNivel();

      // "Só a chave" esconde a parte de arrombar
      const secArrombar = el.querySelector(".lp-sec-arrombar");
      const secJogo = el.querySelector(".lp-sec-jogo");
      const mostrarModo = () => {
        const m = el.querySelector("input[name=modo]:checked")?.value;
        secArrombar?.classList.toggle("lp-oculto", m === "chave");
        secJogo?.classList.toggle("lp-oculto", m !== "minigame" && m !== "ambos");
      };
      for (const rd of el.querySelectorAll("input[name=modo]")) rd.addEventListener("change", mostrarModo);
      mostrarModo();

      const inputSeg = el.querySelector("input[name=segredos]");
      el.querySelector("[data-lp=gerar]")?.addEventListener("click", () => {
        const atual = segredos(inputSeg.value);
        inputSeg.value = [...atual, gerarSegredo()].join(", ");
      });
      const listaEl = el.querySelector(".lp-chaves-da");
      const atualizarLista = () => { if (listaEl) listaEl.innerHTML = listaChaves(inputSeg.value); };
      inputSeg.addEventListener("change", atualizarLista);

      // Botões de cada chave da lista: deixar de abrir esta fechadura ou excluir o item
      listaEl?.addEventListener("click", async ev => {
        const botao = ev.target.closest("[data-lp]");
        const uuid = botao?.closest("[data-uuid]")?.dataset.uuid;
        if (!botao || !uuid) return;
        ev.preventDefault();
        const item = await fromUuid(uuid);
        if (!item) return atualizarLista();
        if (botao.dataset.lp === "desvincular") {
          await desvincularChave(item, inputSeg.value);
          ui.notifications.info(t("Config.Desvinculada", { nome: item.name }));
        } else if (botao.dataset.lp === "excluirItem") {
          const ok = await DialogV2.confirm({
            window: { title: t("Config.ExcluirItem"), icon: "fa-solid fa-trash" },
            content: `<p>${t("Config.ExcluirPergunta", { nome: esc(item.name) })}</p>`,
            rejectClose: false
          });
          if (!ok) return;
          await item.delete();
          ui.notifications.info(t("Config.ItemExcluido", { nome: item.name }));
        }
        atualizarLista();
      });

      // Soltar qualquer item aqui: ele vira chave desta fechadura
      const zona = el.querySelector("[data-lp=soltar]");
      zona?.addEventListener("dragover", ev => { ev.preventDefault(); zona.classList.add("sobre"); });
      zona?.addEventListener("dragleave", () => zona.classList.remove("sobre"));
      zona?.addEventListener("drop", async ev => {
        ev.preventDefault();
        zona.classList.remove("sobre");
        let dados;
        try { dados = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
        const item = dados?.uuid ? await fromUuid(dados.uuid) : null;
        if (!item || item.documentName !== "Item") return ui.notifications.warn(t("Config.SoItens"));
        if (item.pack) return ui.notifications.warn(t("Config.ImporteAntes"));
        if (!segredos(inputSeg.value).length) inputSeg.value = gerarSegredo();
        await tornarChave(item, segredos(inputSeg.value)[0]);
        atualizarLista();
        ui.notifications.info(t("Config.ViraChave", { nome: item.name }));
      });

      el.querySelector("[data-lp=criarChave]")?.addEventListener("click", async () => {
        if (!segredos(inputSeg.value).length) inputSeg.value = gerarSegredo();
        const nome = el.querySelector("input[name=nome]").value || nomeFechadura(doc, f);
        await criarChaveItem({ nome: t("Config.NomeChave", { nome }), segredo: segredos(inputSeg.value)[0] });
        atualizarLista();
        ui.notifications.info(t("Config.LembreSalvar"));
      });
    }
  });

  if (r === "remover") return removerFechadura(doc);
  if (!r || typeof r !== "object") return;

  const novo = foundry.utils.mergeObject(foundry.utils.deepClone(f), r, { inplace: false });
  const zerar = novo.zerarFalhas;
  delete novo.zerarFalhas;
  novo.ativa = true;
  novo.nivel = Math.clamp(Number(novo.nivel) || 1, 1, 10);
  if (remoto) novo.modo = "chave";
  if (zerar) novo.falhas = {};
  const querTrancada = !!novo.trancada;
  // a fechadura começa no estado antigo; sincronizar aplica o novo
  novo.trancada = existe ? f.trancada : !querTrancada;
  // troca o objeto inteiro (senão as falhas zeradas se misturariam com as antigas)
  if (existe) await doc.unsetFlag(ID, "fechadura");
  await doc.setFlag(ID, "fechadura", novo);
  await sincronizar(doc, querTrancada);
  ui.notifications.info(t("Config.Salva", { nome: nomeFechadura(doc) }));
}

export async function removerFechadura(doc) {
  if (!lerFechadura(doc)) return;
  // devolve o objeto ao estado normal antes de tirar a fechadura
  await sincronizar(doc, false);
  await doc.unsetFlag(ID, "fechadura");
  ui.notifications.info(t("Config.Removida"));
}

// ---------- Chave ----------

export async function configurarChave(item) {
  if (!game.user.isGM || item?.documentName !== "Item") return;
  const c = lerChave(item);
  const g = lerGazua(item);
  const existe = !!(c || g);
  const chave = c ?? foundry.utils.deepClone(PADRAO_CHAVE);
  const gazua = g ?? foundry.utils.deepClone(PADRAO_GAZUA);
  const atual = g ? "gazua" : c?.mestra ? "mestra" : "comum";
  const equipavel = item.system && "equipped" in item.system;
  const cfgEquip = game.settings.get(ID, "gazuaEquipada");

  const tipos = [
    { v: "comum", icone: "fa-key" },
    { v: "mestra", icone: "fa-crown" },
    { v: "gazua", icone: "fa-screwdriver" }
  ].map(o => `
    <label class="lp-modo">
      <input type="radio" name="tipoItem" value="${o.v}" ${o.v === atual ? "checked" : ""}>
      <i class="fa-solid ${o.icone}"></i>
      <b>${t(`Chave.Tipo.${o.v}`)}</b>
      <small>${t(`Chave.TipoDica.${o.v}`)}</small>
    </label>`).join("");

  const content = `
    <div class="gazua-mesa lp-config">
      <div class="lp-cabeca">
        <div class="lp-icone"><img src="${esc(item.img)}" alt=""></div>
        <div class="lp-cabeca-txt"><small>${t("Chave.Titulo")}</small><strong>${esc(item.name)}</strong></div>
      </div>
      ${secao("fa-tag", t("Chave.QueTipo"), `<div class="lp-modos lp-tres">${tipos}</div>`)}
      ${secao("fa-hashtag", t("Chave.Segredos"), linha("", `<input type="text" name="segredos" value="${esc(chave.segredos)}" placeholder="${esc(t("Config.SegredosExemplo"))}">`, t("Chave.SegredosDica")), "lp-so-chave")}
      ${secao("fa-crown", t("Chave.Limites"), `
        ${linha(t("Chave.NivelMax"), `<input type="number" name="nivelMax" min="0" max="10" value="${chave.nivelMax}">`, t("Chave.NivelMaxDica"))}
        ${linha(t("Chave.UsosMax"), `<input type="number" name="usosMax" min="0" value="${chave.usosMax}">
          <label class="lp-inline"><input type="checkbox" name="zerarUsos"> ${t("Chave.Zerar", { n: chave.usados })}</label>`, t("Chave.UsosMaxDica"))}`, "lp-so-mestra")}
      ${secao("fa-screwdriver", t("Gazua.Item.Titulo"), `
        ${cfgEquip && !equipavel ? `<p class="lp-aviso"><i class="fa-solid fa-triangle-exclamation"></i> ${t("Gazua.Item.NaoEquipa")}</p>` : ""}
        ${linha(t("Gazua.Item.Bonus"), `<input type="number" name="bonus" min="0" max="10" value="${gazua.bonus}">`, t("Gazua.Item.BonusDica"))}
        ${linha(t("Gazua.Item.Quantidade"), `<input type="number" name="quantidade" min="0" max="999" value="${Number(item.system?.quantity) || 1}">`, t("Gazua.Item.QuantidadeDica"))}
        ${linha(t("Gazua.Item.Usos"), `<input type="number" name="usosGazua" min="1" value="${Math.max(1, gazua.usosMax)}">
          <label class="lp-inline"><input type="checkbox" name="zerarGazua"> ${t("Chave.Zerar", { n: gazua.usados })}</label>`, t("Gazua.Item.UsosDica"))}`, "lp-so-gazua")}
    </div>`;

  const buttons = [
    { action: "salvar", label: t("Config.Salvar"), icon: "fa-solid fa-floppy-disk", default: true, callback: (ev, botao) => lerForm(botao.form) }
  ];
  if (existe) buttons.push({ action: "remover", label: t("Chave.Remover"), icon: "fa-solid fa-trash" });
  buttons.push({ action: "cancelar", label: t("Config.Cancelar"), icon: "fa-solid fa-xmark" });

  const r = await DialogV2.wait({
    window: { title: t("Chave.Titulo"), icon: "fa-solid fa-key" },
    position: { width: 540 },
    classes: ["gazua-mesa", "lp-dialogo"],
    content,
    buttons,
    rejectClose: false,
    render: (a, b) => {
      const el = elementoDo(a, b);
      if (!el) return;
      const mudar = () => {
        const tipo = el.querySelector("input[name=tipoItem]:checked")?.value;
        el.querySelector(".lp-so-chave")?.classList.toggle("lp-oculto", tipo === "gazua");
        el.querySelector(".lp-so-mestra")?.classList.toggle("lp-oculto", tipo !== "mestra");
        el.querySelector(".lp-so-gazua")?.classList.toggle("lp-oculto", tipo !== "gazua");
      };
      for (const rd of el.querySelectorAll("input[name=tipoItem]")) rd.addEventListener("change", mudar);
      mudar();
    }
  });

  if (r === "remover") {
    if (c) await item.unsetFlag(ID, "chave");
    if (g) await item.unsetFlag(ID, "gazua");
    return ui.notifications.info(t("Chave.Removida"));
  }
  if (!r || typeof r !== "object") return;

  if (r.tipoItem === "gazua") {
    const nova = {
      ...gazua, ativa: true,
      bonus: Math.max(0, Number(r.bonus) || 0), usosMax: Math.max(1, Number(r.usosGazua) || 1)
    };
    if (r.zerarGazua) nova.usados = 0;
    if (c) await item.unsetFlag(ID, "chave");
    const upd = { [`flags.${ID}.gazua`]: nova };
    if (item.system && "quantity" in item.system) upd["system.quantity"] = Math.max(0, Math.floor(Number(r.quantidade) || 0));
    await item.update(upd);
    return ui.notifications.info(t("Gazua.Item.Salva", { nome: item.name }));
  }

  const nova = {
    ...chave, segredos: r.segredos ?? "", mestra: r.tipoItem === "mestra", ativa: true,
    nivelMax: Math.max(0, Number(r.nivelMax) || 0), usosMax: Math.max(0, Number(r.usosMax) || 0)
  };
  if (r.zerarUsos) nova.usados = 0;
  if (g) await item.unsetFlag(ID, "gazua");
  await item.update({ [`flags.${ID}.chave`]: nova });
  ui.notifications.info(t("Chave.Salva", { nome: item.name }));
}

// ---------- Painel do mestre ----------

export class PainelFechaduras extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "gazua-mesa-painel",
    classes: ["gazua-mesa", "lp-painel"],
    window: { title: "GAZUAMESA.Painel.Titulo", icon: "fa-solid fa-key", resizable: true },
    position: { width: 560, height: 600 },
    actions: {
      editar: PainelFechaduras.#editar,
      alternar: PainelFechaduras.#alternar,
      ir: PainelFechaduras.#ir,
      testar: PainelFechaduras.#testar,
      editarChave: PainelFechaduras.#editarChave,
      novaChave: PainelFechaduras.#novaChave,
      novaMestra: PainelFechaduras.#novaMestra,
      novaGazua: PainelFechaduras.#novaGazua,
      minijogos: PainelFechaduras.#minijogos
    }
  };

  static abrir() {
    const ja = foundry.applications.instances?.get("gazua-mesa-painel");
    return (ja ?? new PainelFechaduras()).render({ force: true });
  }

  async _renderHTML() {
    const docs = todasFechaduras();
    const linhaF = d => {
      const f = lerFechadura(d);
      const tr = estaTrancada(d, f);
      const segs = segredos(f.segredos).join(", ") || "—";
      return `<li data-uuid="${d.uuid}">
        <i class="fa-solid ${iconeTipo(d.documentName)}" data-tooltip="${esc(t(`Tipo.${d.documentName}`))}"></i>
        <span class="lp-nome">${esc(nomeFechadura(d, f))}<em>${t("Painel.Nivel", { n: f.nivel })} · ${esc(segs)}</em></span>
        <a data-action="alternar" data-tooltip="${esc(t(tr ? "Painel.Destrancar" : "Painel.Trancar"))}" class="${tr ? "fechada" : "aberta"}">
          <i class="fa-solid ${tr ? "fa-lock" : "fa-lock-open"}"></i></a>
        ${REMOTOS.includes(d.documentName) ? "" : `<a data-action="ir" data-tooltip="${esc(t("Painel.Ir"))}"><i class="fa-solid fa-location-crosshairs"></i></a>
        <a data-action="testar" data-tooltip="${esc(t("Painel.Testar"))}"><i class="fa-solid fa-user-secret"></i></a>`}
        <a data-action="editar" data-tooltip="${esc(t("Painel.Editar"))}"><i class="fa-solid fa-gear"></i></a>
      </li>`;
    };
    const chaves = (game.items?.contents ?? []).filter(i => lerChave(i) || lerGazua(i));
    const linhaC = i => {
      const c = lerChave(i);
      const g = lerGazua(i);
      const info = g
        ? `${t("Chave.Tipo.gazua")}${g.bonus ? ` · +${g.bonus}` : ""}${g.usosMax > 1 ? ` · ${g.usados}/${g.usosMax}` : ""}`
        : c.mestra
        ? `${t("Janela.Mestra")} · ${c.nivelMax > 0 ? t("Painel.AteNivel", { n: c.nivelMax }) : t("Painel.QualquerNivel")}${c.usosMax > 0 ? ` · ${c.usados}/${c.usosMax}` : ""}`
        : (segredos(c.segredos).join(", ") || "—");
      return `<li data-uuid="${i.uuid}"><img src="${esc(i.img)}" alt="">
        <span class="lp-nome">${esc(i.name)}<em>${esc(info)}</em></span>
        <a data-action="editarChave" data-tooltip="${esc(t("Painel.Editar"))}"><i class="fa-solid fa-gear"></i></a></li>`;
    };
    return `
      <section>
        <h3><i class="fa-solid fa-lock"></i> ${t("Painel.Fechaduras")}</h3>
        ${docs.length ? `<ul class="lp-lista lp-gm">${docs.map(linhaF).join("")}</ul>` : `<p class="lp-vazio">${t("Painel.SemFechaduras")}</p>`}
        <p class="hint">${t("Painel.ComoCriar")}</p>
      </section>
      <section>
        <h3><i class="fa-solid fa-key"></i> ${t("Painel.Chaves")}</h3>
        ${chaves.length ? `<ul class="lp-lista lp-gm">${chaves.map(linhaC).join("")}</ul>` : `<p class="lp-vazio">${t("Painel.SemChaves")}</p>`}
        <div class="lp-botoes">
          <button type="button" data-action="novaChave"><i class="fa-solid fa-key"></i> ${t("Painel.NovaChave")}</button>
          <button type="button" data-action="novaMestra"><i class="fa-solid fa-crown"></i> ${t("Painel.NovaMestra")}</button>
          <button type="button" data-action="novaGazua"><i class="fa-solid fa-screwdriver"></i> ${t("Painel.NovaGazua")}</button>
        </div>
      </section>
      <section>
        <h3><i class="fa-solid fa-puzzle-piece"></i> ${t("Ajustes.Titulo")}</h3>
        <div class="lp-botoes">
          <button type="button" data-action="minijogos"><i class="fa-solid fa-sliders"></i> ${t("Ajustes.Abrir")}</button>
        </div>
      </section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #doc(alvo) {
    return fromUuid(alvo.closest("[data-uuid]")?.dataset.uuid);
  }

  static async #editar(ev, alvo) {
    const d = await PainelFechaduras.#doc(alvo);
    if (d) await configurarFechadura(d);
    this.render();
  }

  static async #alternar(ev, alvo) {
    const d = await PainelFechaduras.#doc(alvo);
    if (!d) return;
    if (estaTrancada(d)) await destrancar(d);
    else await trancar(d);
    this.render();
  }

  static async #ir(ev, alvo) {
    const d = await PainelFechaduras.#doc(alvo);
    const c = d && centroDoc(d);
    if (c) canvas.animatePan({ x: c.x, y: c.y, duration: 400 });
  }

  static async #testar(ev, alvo) {
    const d = await PainelFechaduras.#doc(alvo);
    if (d) abrirFechadura(d);
  }

  static async #editarChave(ev, alvo) {
    const i = await PainelFechaduras.#doc(alvo);
    if (i) await configurarChave(i);
    this.render();
  }

  static async #novaChave() {
    await criarChaveItem({ nome: t("Painel.NomeNovaChave"), segredo: gerarSegredo() });
    this.render();
  }

  static async #minijogos() {
    const { JanelaMinijogos } = await import("./ajustes.js");
    new JanelaMinijogos().render({ force: true });
  }

  static async #novaGazua() {
    const tipos = game.documentTypes?.Item ?? [];
    const type = tipos.includes("tool") ? "tool" : tipos.includes("loot") ? "loot" : (tipos.find(x => x !== "base") ?? "base");
    const item = await Item.implementation.create({
      name: t("Painel.NomeNovaGazua"), type, img: "icons/tools/hand/lockpicks-steel-grey.webp",
      system: { quantity: 20 },
      flags: { [ID]: { gazua: { ...PADRAO_GAZUA } } }
    });
    item?.sheet?.render(true);
    this.render();
  }

  static async #novaMestra() {
    await criarChaveItem({ nome: t("Painel.NomeNovaMestra"), segredo: "", mestra: true });
    this.render();
  }
}

