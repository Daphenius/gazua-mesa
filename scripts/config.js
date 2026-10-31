// Gazua da Mesa — telas do mestre: configurar fechadura, configurar chave e o painel da cena.

import {
  ID, t, esc, PADRAO_FECHADURA, PADRAO_CHAVE, lerFechadura, lerChave, estaTrancada, podeTerFechadura,
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
    else if (el.type === "number") dados[el.name] = Number(el.value) || 0;
    else dados[el.name] = el.value.trim();
  }
  return dados;
}

const opcoes = (lista, atual, prefixo) => lista.map(v =>
  `<option value="${v}" ${v === atual ? "selected" : ""}>${t(`${prefixo}.${v}`)}</option>`).join("");

const marcado = v => (v ? "checked" : "");

function campo(rotulo, html, dica = "") {
  return `<div class="form-group"><label>${rotulo}</label><div class="form-fields">${html}</div>${dica ? `<p class="hint">${dica}</p>` : ""}</div>`;
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

// ---------- Fechadura ----------

export async function configurarFechadura(doc) {
  if (!game.user.isGM || !podeTerFechadura(doc)) return;
  const existe = !!doc.flags?.[ID]?.fechadura;
  const f = lerFechadura(doc) ?? foundry.utils.deepClone(PADRAO_FECHADURA);
  const tipo = doc.documentName;
  const trancada = existe ? estaTrancada(doc, f) : true;
  const temGatilho = !!doc.flags?.["navegador-mapas"]?.gatilho;
  const remoto = REMOTOS.includes(tipo);

  let efeitos = "";
  if (tipo === "Wall") efeitos += campo(t("Config.AbrirPorta"), `<input type="checkbox" name="abrirPorta" ${marcado(f.abrirPorta)}>`, t("Config.AbrirPortaDica"));
  if (["Tile", "Token"].includes(tipo)) {
    efeitos += campo(t("Config.Visibilidade"), `<select name="visibilidade">${opcoes(["nada", "mostrar", "esconder"], f.visibilidade, "Config.Vis")}</select>`, t("Config.VisibilidadeDica"));
  }
  if (["Token", "JournalEntry", "JournalEntryPage"].includes(tipo)) {
    efeitos += campo(t("Config.Permissao"), `<select name="permissao">${opcoes(["nenhuma", "observador", "dono"], f.permissao, "Config.Perm")}</select>`,
      t(tipo === "Token" ? "Config.PermissaoDicaToken" : "Config.PermissaoDicaDiario"));
  }
  efeitos += campo(t("Config.ParaTodos"), `<input type="checkbox" name="paraTodos" ${marcado(f.paraTodos)}>`, t("Config.ParaTodosDica"));
  if (temGatilho) efeitos += campo(t("Config.Gatilho"), `<input type="checkbox" name="gatilho" ${marcado(f.gatilho)}>`, t("Config.GatilhoDica"));
  efeitos += campo(t("Config.Journal"), `<input type="text" name="journal" data-uuid value="${esc(f.journal)}" placeholder="${esc(t("Config.ArrasteAqui"))}">`, t("Config.JournalDica"));
  efeitos += campo(t("Config.Macro"), `<input type="text" name="macro" data-uuid value="${esc(f.macro)}" placeholder="${esc(t("Config.ArrasteAqui"))}">`, t("Config.MacroDica"));
  efeitos += campo(t("Config.Mensagem"), `<textarea name="mensagem" rows="2">${esc(f.mensagem)}</textarea>`);

  let semChave = "";
  if (!remoto) {
    semChave = `
      ${campo(t("Config.Modo"), `<select name="modo">${opcoes(["ambos", "minigame", "teste", "chave"], f.modo, "Config.Modos")}</select>`)}
      ${campo(t("Config.CD"), `<input type="number" name="cd" min="1" max="40" value="${f.cd}">`, t("Config.CDDica"))}
      ${campo(t("Config.Ferramentas"), `<input type="checkbox" name="exigeFerramentas" ${marcado(f.exigeFerramentas)}>`)}
      ${campo(t("Config.Tentativas"), `<input type="number" name="tentativas" min="0" value="${f.tentativas}">
        <label class="lp-inline"><input type="checkbox" name="zerarFalhas"> ${t("Config.ZerarFalhas")}</label>`, t("Config.TentativasDica"))}
      ${campo(t("Config.Alcance"), `<input type="number" name="alcance" min="0" step="0.5" value="${f.alcance}">`, t("Config.AlcanceDica"))}`;
  }

  const content = `
    <div class="gazua-mesa lp-config">
      <p class="lp-alvo"><i class="fa-solid ${iconeTipo(tipo)}"></i> ${t(`Tipo.${tipo}`)}: <strong>${esc(nomeFechadura(doc, f))}</strong></p>
      <fieldset><legend>${t("Config.Fechadura")}</legend>
        ${campo(t("Config.Nome"), `<input type="text" name="nome" value="${esc(f.nome)}" placeholder="${esc(nomeFechadura(doc, { nome: "" }))}">`)}
        ${campo(t("Config.Trancada"), `<input type="checkbox" name="trancada" ${marcado(trancada)}>`)}
        ${campo(t("Config.Nivel"), `<input type="number" name="nivel" min="1" max="10" value="${f.nivel}">`, t("Config.NivelDica"))}
        ${campo(t("Config.Segredos"), `<input type="text" name="segredos" value="${esc(f.segredos)}">
          <button type="button" data-lp="gerar" data-tooltip="${esc(t("Config.Gerar"))}"><i class="fa-solid fa-dice"></i></button>`, t("Config.SegredosDica"))}
        ${campo(t("Config.Mestra"), `<input type="checkbox" name="aceitaMestra" ${marcado(f.aceitaMestra)}>`, t("Config.MestraDica"))}
        <button type="button" data-lp="criarChave"><i class="fa-solid fa-key"></i> ${t("Config.CriarChave")}</button>
      </fieldset>
      ${semChave ? `<fieldset><legend>${t("Config.SemChave")}</legend>${semChave}</fieldset>` : ""}
      <fieldset><legend>${t("Config.AoDestrancar")}</legend>${efeitos}</fieldset>
    </div>`;

  const buttons = [
    { action: "salvar", label: t("Config.Salvar"), icon: "fa-solid fa-floppy-disk", default: true, callback: (ev, botao) => lerForm(botao.form) }
  ];
  if (existe) buttons.push({ action: "remover", label: t("Config.Remover"), icon: "fa-solid fa-trash" });
  buttons.push({ action: "cancelar", label: t("Config.Cancelar"), icon: "fa-solid fa-xmark" });

  const r = await DialogV2.wait({
    window: { title: t("Config.TituloFechadura"), icon: "fa-solid fa-lock" },
    position: { width: 520 },
    classes: ["gazua-mesa"],
    content,
    buttons,
    rejectClose: false,
    render: (a, b) => {
      const el = elementoDo(a, b);
      if (!el) return;
      aceitarArraste(el);
      const inputSeg = el.querySelector("input[name=segredos]");
      el.querySelector("[data-lp=gerar]")?.addEventListener("click", () => {
        const atual = segredos(inputSeg.value);
        inputSeg.value = [...atual, gerarSegredo()].join(", ");
      });
      el.querySelector("[data-lp=criarChave]")?.addEventListener("click", async () => {
        if (!segredos(inputSeg.value).length) inputSeg.value = gerarSegredo();
        const nome = el.querySelector("input[name=nome]").value || nomeFechadura(doc, f);
        await criarChaveItem({ nome: t("Config.NomeChave", { nome }), segredo: segredos(inputSeg.value)[0] });
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
  const existe = !!item.flags?.[ID]?.chave;
  const c = lerChave(item) ?? foundry.utils.deepClone(PADRAO_CHAVE);

  const content = `
    <div class="gazua-mesa lp-config">
      <p class="lp-alvo"><i class="fa-solid fa-key"></i> <strong>${esc(item.name)}</strong></p>
      ${campo(t("Chave.Segredos"), `<input type="text" name="segredos" value="${esc(c.segredos)}">`, t("Chave.SegredosDica"))}
      ${campo(t("Chave.Mestra"), `<input type="checkbox" name="mestra" ${marcado(c.mestra)}>`, t("Chave.MestraDica"))}
      <div class="lp-mestra">
        ${campo(t("Chave.NivelMax"), `<input type="number" name="nivelMax" min="0" max="10" value="${c.nivelMax}">`, t("Chave.NivelMaxDica"))}
        ${campo(t("Chave.UsosMax"), `<input type="number" name="usosMax" min="0" value="${c.usosMax}">
          <label class="lp-inline"><input type="checkbox" name="zerarUsos"> ${t("Chave.Zerar", { n: c.usados })}</label>`, t("Chave.UsosMaxDica"))}
      </div>
      <p class="hint">${t("Chave.Gasta")}</p>
    </div>`;

  const buttons = [
    { action: "salvar", label: t("Config.Salvar"), icon: "fa-solid fa-floppy-disk", default: true, callback: (ev, botao) => lerForm(botao.form) }
  ];
  if (existe) buttons.push({ action: "remover", label: t("Chave.Remover"), icon: "fa-solid fa-trash" });
  buttons.push({ action: "cancelar", label: t("Config.Cancelar"), icon: "fa-solid fa-xmark" });

  const r = await DialogV2.wait({
    window: { title: t("Chave.Titulo"), icon: "fa-solid fa-key" },
    position: { width: 460 },
    classes: ["gazua-mesa"],
    content,
    buttons,
    rejectClose: false,
    render: (a, b) => {
      const el = elementoDo(a, b);
      const cb = el?.querySelector("input[name=mestra]");
      const bloco = el?.querySelector(".lp-mestra");
      if (!cb || !bloco) return;
      const mudar = () => bloco.classList.toggle("lp-oculto", !cb.checked);
      cb.addEventListener("change", mudar);
      mudar();
    }
  });

  if (r === "remover") {
    await item.unsetFlag(ID, "chave");
    return ui.notifications.info(t("Chave.Removida"));
  }
  if (!r || typeof r !== "object") return;
  const nova = { ...c, segredos: r.segredos, mestra: r.mestra, nivelMax: Math.max(0, r.nivelMax), usosMax: Math.max(0, r.usosMax), ativa: true };
  if (r.zerarUsos) nova.usados = 0;
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
      novaMestra: PainelFechaduras.#novaMestra
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
    const chaves = (game.items?.contents ?? []).filter(i => lerChave(i));
    const linhaC = i => {
      const c = lerChave(i);
      const info = c.mestra
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

  static async #novaMestra() {
    await criarChaveItem({ nome: t("Painel.NomeNovaMestra"), segredo: "", mestra: true });
    this.render();
  }
}
