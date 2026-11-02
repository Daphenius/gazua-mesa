// Gazua da Mesa — minijogos de arrombar (a parte da tela).
//
// As regras de cada jogo ficam em logica.js, sem nada do Foundry, para o mestre poder refazer
// as jogadas e decidir o resultado. Aqui cada jogo só desenha e repassa as jogadas.
//
// Todos dividem a mesma base: cronômetro (tempo limite), resistência da gazua, mensagens,
// "como jogar" e o resultado. Todos têm tema arcano: a fechadura é protegida por um
// encantamento que a gazua precisa desfazer.
//  - Anéis rúnicos (discos): gire os anéis até a runa-chave de cada um ficar sob o sigilo do topo.
//              Girar um anel pode arrastar o vizinho junto.
//  - Selo rúnico (runas): o selo acende uma sequência de runas; repita (em níveis altos, ao contrário).
//  - Fio de mana (labirinto): conduza uma centelha pelas linhas invisíveis da proteção até o núcleo;
//              cada choque revela uma barreira e abala a concentração.
//  - Sigilo de traço (sigilo): trace todas as linhas do sigilo sem passar duas vezes pela mesma.
//  - Cristais em harmonia (cristais): tocar um cristal inverte ele e os vizinhos; acenda todos.
//  - Canalizar (canalizar): segure para erguer a mana e mantenha-a dentro da faixa rúnica até encher o selo.

import { t, esc, bonusArrombar, JOGOS } from "./dados.js";
import { lerAjustes, jogosAtivos } from "./ajustes.js";
import { POS, DT, RECOMECAR, criarLogica, calcularParametros, novaSemente } from "./logica.js";

const { ApplicationV2 } = foundry.applications.api;

// Runas desenhadas à mão em traços (caixa de 10 x 16), no estilo das runas antigas
const GLIFOS = [
  "M2 16 V0 M2 5 L9 1 M2 10 L9 6",          // riqueza
  "M2 16 V0 L8 5 V16",                       // força
  "M2 0 V16 M2 4 L8 8 L2 12",                // espinho
  "M2 16 V0 L8 4 M2 6 L8 10",                // sopro
  "M2 16 V0 L8 4 L2 8 L8 16",                // jornada
  "M8 0 L2 8 L8 16",                         // tocha
  "M5 16 V0 M5 7 L1 2 M5 7 L9 2",            // proteção
  "M8 1 L2 6 L8 10 L2 15",                   // sol
  "M5 16 V0 M1 5 L5 0 L9 5",                 // lança
  "M1 16 L9 7 L5 1 L1 7 L9 16",              // herança
  "M1 0 V16 M9 0 V16 M1 4 L9 12",            // granizo
  "M1 2 L5 8 L9 2 M1 14 L5 8 L9 14"          // dia
];

/** Uma runa em SVG, centrada em (x, y). */
function glifo(i, x = 0, y = 0, escala = 1, classe = "lp-glifo") {
  return `<path class="${classe}" d="${GLIFOS[i % GLIFOS.length]}" transform="translate(${x - 5 * escala} ${y - 8 * escala}) scale(${escala})"/>`;
}

/** Parâmetros do jogo para este personagem (ver calcularParametros em logica.js). */
export function parametros(f, actor, opcoes = {}, tipo = "discos", ajustes = null) {
  const aj = { ...lerAjustes(tipo), ...(ajustes ?? {}) };
  return calcularParametros(f, bonusArrombar(actor), opcoes, aj);
}

/** O jogo da fechadura, ou um sorteado entre os ativos (Surpresa). */
export function escolherJogo(f) {
  const j = f.minijogo;
  if (JOGOS.includes(j)) return j;
  const ativos = jogosAtivos();
  return ativos[Math.floor(Math.random() * ativos.length)];
}

/**
 * Abre o minijogo e espera o fim. Devolve { sucesso, registro } (o registro vai para o mestre
 * conferir) ou null se o minijogo nem abriu.
 * opcoes: { parametros, nome, semente, decorrido (segundos já passados, ao retomar) }
 */
export function jogar(tipo, opcoes) {
  const Classe = { discos: Discos, runas: Runas, labirinto: Labirinto, sigilo: Sigilo, cristais: Cristais, canalizar: Canalizar }[tipo] ?? Discos;
  return new Promise(resolve => {
    const app = new Classe({ ...opcoes, resolve });
    app.render({ force: true }).catch(err => {
      console.error("gazua-mesa | o minijogo não abriu:", err);
      ui.notifications.error(t("Aviso.ErroJogo"));
      app._resolve = null;
      resolve(null);
    });
  });
}

// ======================================================================
// Base
// ======================================================================

class MiniJogo extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["gazua-mesa", "lp-jogo"],
    window: { icon: "fa-solid fa-unlock-keyhole" },
    position: { width: 480 },
    actions: { desistir: MiniJogo.#desistir }
  };

  static TIPO = "";

  constructor(options) {
    super(options);
    this.p = options.parametros;
    this.nome = options.nome;
    this._resolve = options.resolve;
    this.fim = null;
    this.aj = this.p.aj ?? {};
    // as regras do jogo, montadas a partir da semente que o mestre sorteou
    this.l = criarLogica(this.constructor.TIPO, this.p, options.semente ?? novaSemente());
    this.restante = Math.max(0, this.p.tempo - (Number(options.decorrido) || 0));
    this._tecla = ev => {
      if (this.fim || ev.target?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (this.tecla(ev) === true) { ev.preventDefault(); ev.stopPropagation(); }
    };
  }

  get title() { return t(`Jogo.${this.constructor.TIPO}.Nome`); }
  get vidasMax() { return this.l.vidasMax; }

  corpo() { return ""; }
  iniciar() {}
  tecla() { return false; }
  quadro() {}
  desenhar() {}

  /** Passa a jogada para as regras e mostra o que aconteceu. */
  jogar(jogada) {
    if (this.fim) return null;
    const ev = this.l.jogar(jogada);
    this.desenhar();
    if (!ev) return null;
    if (ev.erro) { this.atualizarVidas(); this.tremer(); }
    if (this.l.fim) {
      this.terminar(this.l.fim === "ok", this.l.motivo ? t(this.l.motivo) : undefined);
    } else if (ev.chave) {
      this.mensagem(t(ev.chave, ev.dados), ev.classe ?? "");
    }
    return ev;
  }

  async _renderHTML() {
    const tipo = this.constructor.TIPO;
    const vidas = Array.from({ length: this.vidasMax }, () => `<i class="fa-solid fa-gem"></i>`).join("");
    const passos = [1, 2, 3].map(n => `<li>${t(`Jogo.${tipo}.Passo${n}`)}</li>`).join("");
    const extra = this.p.extra > 0 && this.p.tempo > 0 ? ` <em>(+${this.p.extra}s)</em>` : "";
    return `
      <div class="lp-mg lp-${tipo}">
        <header class="lp-mg-topo">
          <span class="lp-mg-nome"><i class="fa-solid fa-lock"></i> ${esc(this.nome)}</span>
          ${this.vidasMax > 0 ? `<span class="lp-vidas" data-tooltip="${esc(t("Jogo.Resistencia"))}">${vidas}</span>` : ""}
        </header>
        ${this.p.tempo > 0 ? `
          <div class="lp-relogio"><i class="fa-solid fa-hourglass-half"></i>
            <div class="lp-relogio-barra"><div></div></div><span class="lp-relogio-txt"></span>${extra}
          </div>` : ""}
        <div class="lp-palco">${this.corpo()}</div>
        <p class="lp-feedback">${t(`Jogo.${tipo}.Comeco`)}</p>
        <details class="lp-como">
          <summary><i class="fa-solid fa-circle-question"></i> ${t("Jogo.ComoJogar")}</summary>
          <ol>${passos}</ol>
        </details>
        <footer class="lp-botoes">
          <button type="button" data-action="desistir"><i class="fa-solid fa-xmark"></i> ${t("Jogo.Desistir")}</button>
        </footer>
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    document.addEventListener("keydown", this._tecla, true);
    this.iniciar(this.element);
    this.atualizarVidas();
    let antes = performance.now();
    const passo = agora => {
      if (!this.rendered) return;
      const dt = Math.min(0.1, (agora - antes) / 1000);
      antes = agora;
      if (!this.fim) {
        this.quadro(dt);
        if (this.p.tempo > 0 && !this.fim) {
          this.restante = Math.max(0, this.restante - dt);
          this.desenharRelogio();
          if (this.restante <= 0) this.terminar(false, t("Jogo.Tempo"));
        }
      }
      this._raf = requestAnimationFrame(passo);
    };
    this.desenharRelogio();
    if (this.p.tempo > 0 && this.restante <= 0) this.terminar(false, t("Jogo.Tempo"));
    this._raf = requestAnimationFrame(passo);
  }

  desenharRelogio() {
    const el = this.element;
    if (!el || !(this.p.tempo > 0)) return;
    const pct = (this.restante / this.p.tempo) * 100;
    const barra = el.querySelector(".lp-relogio-barra div");
    if (barra) {
      barra.style.width = `${pct}%`;
      barra.classList.toggle("pouco", pct < 25);
    }
    const txt = el.querySelector(".lp-relogio-txt");
    if (txt) txt.textContent = `${Math.ceil(this.restante)}s`;
  }

  mensagem(texto, classe = "") {
    const el = this.element?.querySelector(".lp-feedback");
    if (!el) return;
    el.innerHTML = texto;
    el.className = `lp-feedback ${classe}`;
  }

  atualizarVidas() {
    this.element?.querySelectorAll(".lp-vidas i").forEach((i, k) => i.classList.toggle("quebrada", k >= this.l.vidas));
  }

  tremer() {
    const palco = this.element?.querySelector(".lp-palco");
    if (!palco) return;
    palco.classList.remove("lp-tremer");
    void palco.offsetWidth;
    palco.classList.add("lp-tremer");
  }

  terminar(sucesso, texto) {
    if (this.fim) return;
    this.fim = sucesso ? "ok" : "falha";
    this.mensagem(texto ?? t(sucesso ? "Jogo.Abriu" : "Jogo.Quebrou"), sucesso ? "ok" : "erro");
    this.element?.querySelector(".lp-mg")?.classList.add(sucesso ? "lp-abriu" : "lp-quebrou");
    setTimeout(() => this.close(), sucesso ? 1600 : 1400);
  }

  static #desistir() {
    this.terminar(false, t("Jogo.Desistiu"));
  }

  async close(options) {
    document.removeEventListener("keydown", this._tecla, true);
    cancelAnimationFrame(this._raf);
    const resolve = this._resolve;
    this._resolve = null;
    // fechar no meio conta como desistência; quem decide de verdade é o mestre, refazendo o registro
    resolve?.({ sucesso: this.fim === "ok", registro: this.l.registro });
    return super.close(options);
  }
}

// ======================================================================
// Anéis rúnicos: alinhe as runas-chave sob o sigilo
// ======================================================================

export class Discos extends MiniJogo {
  static TIPO = "discos";

  constructor(options) {
    super(options);
    this.sel = this.l.n - 1;
    this.ang = this.l.pos.map(p => p * 45);    // ângulo acumulado (para a animação não voltar)
  }

  raio(i) { return 48 + i * 24; }

  corpo() {
    const n = this.l.n;
    const discos = Array.from({ length: n }, (_, i) => {
      const r = this.raio(i);
      // runas gravadas em volta do anel; a da posição 0 é a runa-chave
      const runas = Array.from({ length: POS }, (_, k) => {
        const a = (k * 45 - 90) * Math.PI / 180;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        return `<g transform="rotate(${k * 45} ${x} ${y})">${glifo(this.l.glifos[i][k], x, y, 0.62, k === 0 ? "lp-glifo lp-chave-runa" : "lp-glifo")}</g>`;
      }).join("");
      return `
        <g class="lp-disco" data-i="${i}">
          <circle class="lp-disco-aro" r="${r}"/>
          ${runas}
        </g>`;
    }).join("");
    const R = this.raio(n - 1) + 18;
    return `
      <svg class="lp-discos-svg" viewBox="${-R} ${-R} ${R * 2} ${R * 2}">
        <circle class="lp-caixa" r="${R - 4}"/>
        <circle class="lp-aura" r="${R - 10}"/>
        <rect class="lp-canal" x="-12" y="${-R + 2}" width="24" height="${R - 30}" rx="12"/>
        ${discos}
        <circle class="lp-miolo" r="30"/>
        <g class="lp-ferrolho">${glifo(6, 0, 0, 1.6, "lp-glifo lp-nucleo")}</g>
        <path class="lp-sigilo" d="M -10 ${-R + 1} L 10 ${-R + 1} L 0 ${-R + 13} Z"/>
      </svg>
      <div class="lp-discos-controle">
        <button type="button" data-lado="-1" data-tooltip="${esc(t("Jogo.discos.Esquerda"))}"><i class="fa-solid fa-rotate-left"></i></button>
        <span class="lp-disco-sel"></span>
        <button type="button" data-lado="1" data-tooltip="${esc(t("Jogo.discos.Direita"))}"><i class="fa-solid fa-rotate-right"></i></button>
      </div>`;
  }

  iniciar(el) {
    const svg = el.querySelector(".lp-discos-svg");
    const escolher = ev => {
      const m = svg.getScreenCTM?.();
      if (!m) return null;
      const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
      const d = Math.hypot(p.x, p.y);
      let melhor = null, dist = 14;
      for (let i = 0; i < this.l.n; i++) {
        const delta = Math.abs(d - this.raio(i));
        if (delta < dist) { dist = delta; melhor = i; }
      }
      return melhor;
    };
    svg.addEventListener("pointerdown", ev => {
      if (this.fim) return;
      const i = escolher(ev);
      if (i == null) return;
      ev.preventDefault();
      this.sel = i;
      this.acao(ev.button === 2 || ev.shiftKey ? -1 : 1);
    });
    svg.addEventListener("contextmenu", ev => ev.preventDefault());
    svg.addEventListener("pointermove", ev => {
      const i = escolher(ev);
      svg.querySelectorAll(".lp-disco").forEach((g, k) => g.classList.toggle("ligado", i != null && this.l.ligacoes[i].includes(k) && k !== i));
    });
    svg.addEventListener("pointerleave", () => svg.querySelectorAll(".lp-disco.ligado").forEach(g => g.classList.remove("ligado")));
    for (const b of el.querySelectorAll("[data-lado]")) b.addEventListener("click", () => this.acao(Number(b.dataset.lado)));
    this.desenhar();
  }

  acao(dir) {
    if (this.fim) return;
    for (const j of this.l.ligacoes[this.sel]) this.ang[j] += dir * 45;
    this.jogar([this.sel, dir]);
  }

  desenhar() {
    const el = this.element;
    if (!el) return;
    el.querySelectorAll(".lp-disco").forEach((g, i) => {
      g.style.transform = `rotate(${this.ang[i]}deg)`;
      g.classList.toggle("sel", i === this.sel);
      g.classList.toggle("certo", this.l.pos[i] === 0);
    });
    const s = el.querySelector(".lp-disco-sel");
    if (s) s.textContent = t("Jogo.discos.Disco", { n: this.l.n - this.sel, total: this.l.n });
  }

  tecla(ev) {
    const k = ev.code;
    if (k === "ArrowUp" || k === "KeyW") { this.sel = Math.min(this.l.n - 1, this.sel + 1); this.desenhar(); return true; }
    if (k === "ArrowDown" || k === "KeyS") { this.sel = Math.max(0, this.sel - 1); this.desenhar(); return true; }
    if (k === "ArrowLeft" || k === "KeyA") { this.acao(-1); return true; }
    if (k === "ArrowRight" || k === "KeyD") { this.acao(1); return true; }
    return false;
  }

  terminar(sucesso, texto) {
    if (sucesso) this.element?.querySelector(".lp-ferrolho")?.classList.add("aberto");
    super.terminar(sucesso, texto);
  }
}

// ======================================================================
// Selo rúnico: repita a sequência do selo
// ======================================================================

export class Runas extends MiniJogo {
  static TIPO = "runas";

  constructor(options) {
    super(options);
    this.mostrando = true;    // só aceita toques depois de o selo mostrar a sequência
  }

  corpo() {
    const R = 104, l = this.l;
    const runas = Array.from({ length: l.qtd }, (_, i) => {
      const a = (i / l.qtd) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * R, y = Math.sin(a) * R;
      return `<button type="button" class="lp-runa" data-i="${i}" style="left:calc(50% + ${x}px);top:calc(50% + ${y}px)">
        <svg viewBox="-2 -2 14 20">${glifo(l.simbolos[i], 5, 8)}</svg></button>`;
    }).join("");
    return `
      <div class="lp-selo-runas">
        <div class="lp-circulo"></div>
        ${runas}
        <div class="lp-centro">
          <div class="lp-contas">${l.seq.map(() => "<span></span>").join("")}</div>
          <small>${l.invertida ? t("Jogo.runas.AoContrario") : ""}</small>
        </div>
      </div>`;
  }

  iniciar(el) {
    for (const b of el.querySelectorAll(".lp-runa")) {
      b.addEventListener("click", () => this.tocar(Number(b.dataset.i)));
    }
    setTimeout(() => this.mostrar(), 600);
  }

  async mostrar() {
    if (this.fim) return;
    this.mostrando = true;
    this.desenhar();
    this.element?.querySelector(".lp-selo-runas")?.classList.add("mostrando");
    this.mensagem(t("Jogo.runas.Observe"));
    const espera = ms => new Promise(r => setTimeout(r, ms));
    for (const i of this.l.seq) {
      if (this.fim || !this.rendered) return;
      this.acender(i, this.l.ritmo * 0.7);
      await espera(this.l.ritmo);
    }
    this.mostrando = false;
    this.element?.querySelector(".lp-selo-runas")?.classList.remove("mostrando");
    this.mensagem(t(this.l.invertida ? "Jogo.runas.RepitaInvertido" : "Jogo.runas.Repita"));
  }

  acender(i, ms) {
    const b = this.element?.querySelector(`.lp-runa[data-i="${i}"]`);
    if (!b) return;
    b.classList.add("acesa");
    setTimeout(() => b.classList.remove("acesa"), ms);
  }

  desenhar() {
    this.element?.querySelectorAll(".lp-contas span").forEach((s, k) => s.classList.toggle("on", k < this.l.entrada.length));
  }

  tocar(i) {
    if (this.fim || this.mostrando) return;
    this.acender(i, 250);
    const ev = this.jogar(i);
    if (ev?.erro && !this.fim) {
      this.mostrando = true;
      setTimeout(() => this.mostrar(), 900);
    }
  }

  tecla(ev) {
    const n = Number(ev.key);
    if (n >= 1 && n <= this.l.qtd) { this.tocar(n - 1); return true; }
    return false;
  }
}

// ======================================================================
// Fio de mana: tateie o caminho até a trava
// ======================================================================

export class Labirinto extends MiniJogo {
  static TIPO = "labirinto";

  corpo() {
    const L = 36, s = this.l.s, W = s * L;
    return `
      <svg class="lp-lab-svg" viewBox="-16 -6 ${W + 44} ${W + 12}">
        <rect class="lp-lab-fundo" x="0" y="0" width="${W}" height="${W}" rx="6"/>
        <g class="lp-lab-pontos">${Array.from({ length: s * s }, (_, k) =>
          `<circle cx="${(k % s) * L + L / 2}" cy="${Math.floor(k / s) * L + L / 2}" r="1.3"/>`).join("")}</g>
        <g class="lp-lab-rastro"></g>
        <g class="lp-lab-paredes"></g>
        <circle class="lp-lab-buraco" cx="-6" cy="${this.l.pos.r * L + L / 2}" r="7"/>
        <g class="lp-lab-trava" transform="translate(${W + 10} ${this.l.alvo.r * L + L / 2})">
          <circle r="11"/>
          ${glifo(6, 0, 0, 0.9, "lp-glifo")}
        </g>
        <circle class="lp-lab-ponta" r="7"/>
      </svg>
      <div class="lp-setas">
        <button type="button" data-d="-1,0"><i class="fa-solid fa-arrow-up"></i></button>
        <button type="button" data-d="0,-1"><i class="fa-solid fa-arrow-left"></i></button>
        <button type="button" data-d="1,0"><i class="fa-solid fa-arrow-down"></i></button>
        <button type="button" data-d="0,1"><i class="fa-solid fa-arrow-right"></i></button>
      </div>`;
  }

  iniciar(el) {
    for (const b of el.querySelectorAll("[data-d]")) {
      b.addEventListener("click", () => this.jogar(b.dataset.d.split(",").map(Number)));
    }
    this.desenhar();
  }

  desenhar() {
    const el = this.element;
    if (!el) return;
    const L = 36;
    const rastro = this.aj.mostrarRastro === false ? [] : [...this.l.rastro];
    el.querySelector(".lp-lab-rastro").innerHTML = rastro.map(k => {
      const [r, c] = k.split(",").map(Number);
      return `<rect x="${c * L + 3}" y="${r * L + 3}" width="${L - 6}" height="${L - 6}" rx="5"/>`;
    }).join("");
    el.querySelector(".lp-lab-paredes").innerHTML = [...this.l.vistas].map(k => {
      const [r, c, dr, dc] = k.split(",").map(Number);
      const x = c * L, y = r * L;
      if (dc === 1) return `<line x1="${x + L}" y1="${y}" x2="${x + L}" y2="${y + L}"/>`;
      if (dc === -1) return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + L}"/>`;
      if (dr === 1) return `<line x1="${x}" y1="${y + L}" x2="${x + L}" y2="${y + L}"/>`;
      return `<line x1="${x}" y1="${y}" x2="${x + L}" y2="${y}"/>`;
    }).join("");
    const ponta = el.querySelector(".lp-lab-ponta");
    ponta.setAttribute("cx", this.l.pos.c * L + L / 2);
    ponta.setAttribute("cy", this.l.pos.r * L + L / 2);
  }

  tecla(ev) {
    const mapa = { ArrowUp: [-1, 0], KeyW: [-1, 0], ArrowDown: [1, 0], KeyS: [1, 0], ArrowLeft: [0, -1], KeyA: [0, -1], ArrowRight: [0, 1], KeyD: [0, 1] };
    const d = mapa[ev.code];
    if (!d) return false;
    this.jogar(d);
    return true;
  }
}

// ======================================================================
// Sigilo de traço: percorra todas as linhas sem repetir nenhuma
// ======================================================================

export class Sigilo extends MiniJogo {
  static TIPO = "sigilo";

  corpo() {
    const R = 140, l = this.l;
    const linhas = l.arestas.map(([a, b], k) => {
      const A = l.nos[a], B = l.nos[b];
      return `<line class="lp-traco" data-k="${k}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`;
    }).join("");
    // runas sem nenhuma linha não aparecem (só confundiriam)
    const dica = this.aj.dicaImpar === true;
    const nos = l.nos.map((n, i) => l.grau(i) === 0 ? "" : `
      <g class="lp-no ${dica && l.grau(i) % 2 ? "impar" : ""}" data-i="${i}" transform="translate(${n.x} ${n.y})">
        <circle r="13"/>${glifo(i, 0, 0, 0.7)}
      </g>`).join("");
    return `
      <svg class="lp-sigilo-svg" viewBox="${-R} ${-R} ${R * 2} ${R * 2}">
        <circle class="lp-sigilo-aro" r="${R - 6}"/>
        <g>${linhas}</g>
        ${nos}
      </svg>
      <div class="lp-sigilo-info"><span class="lp-sigilo-cont"></span>
        <button type="button" class="lp-mini" data-lp="recomecar"><i class="fa-solid fa-rotate"></i> ${t("Jogo.sigilo.Recomecar")}</button></div>`;
  }

  iniciar(el) {
    for (const g of el.querySelectorAll(".lp-no")) g.addEventListener("click", () => this.jogar(Number(g.dataset.i)));
    el.querySelector("[data-lp=recomecar]")?.addEventListener("click", () => this.jogar(RECOMECAR));
    this.desenhar();
  }

  desenhar() {
    const el = this.element;
    if (!el) return;
    el.querySelectorAll(".lp-traco").forEach(l => l.classList.toggle("feito", this.l.usadas.has(Number(l.dataset.k))));
    el.querySelectorAll(".lp-no").forEach(g => g.classList.toggle("atual", Number(g.dataset.i) === this.l.atual));
    const c = el.querySelector(".lp-sigilo-cont");
    if (c) c.textContent = t("Jogo.sigilo.Contagem", { n: this.l.usadas.size, total: this.l.arestas.length });
  }
}

// ======================================================================
// Cristais em harmonia: tocar um cristal inverte ele e os vizinhos
// ======================================================================

export class Cristais extends MiniJogo {
  static TIPO = "cristais";

  corpo() {
    const g = this.l.g;
    const cel = Array.from({ length: g * g }, (_, i) =>
      `<button type="button" class="lp-cristal" data-i="${i}"><svg viewBox="-2 -2 14 20">${glifo(i, 5, 8)}</svg></button>`).join("");
    return `<div class="lp-cristais" style="grid-template-columns:repeat(${g}, 1fr)">${cel}</div>
      <p class="lp-cristais-info"></p>`;
  }

  iniciar(el) {
    for (const b of el.querySelectorAll(".lp-cristal")) b.addEventListener("click", () => this.jogar(Number(b.dataset.i)));
    this.desenhar();
  }

  desenhar() {
    const el = this.element;
    if (!el) return;
    const luz = this.l.luz;
    el.querySelectorAll(".lp-cristal").forEach((b, i) => b.classList.toggle("aceso", luz[i]));
    const info = el.querySelector(".lp-cristais-info");
    if (info) info.textContent = t("Jogo.cristais.Contagem", { n: luz.filter(Boolean).length, total: luz.length, toques: this.l.toques });
  }
}

// ======================================================================
// Canalizar: mantenha a mana dentro da faixa rúnica até encher o selo
// ======================================================================

export class Canalizar extends MiniJogo {
  static TIPO = "canalizar";

  constructor(options) {
    super(options);
    this.segurando = false;
    this.acumulado = 0;
    this._soltar = () => { this.segurando = false; };
  }

  corpo() {
    return `
      <div class="lp-canal-area">
        <div class="lp-coluna">
          <div class="lp-faixa"></div>
          <div class="lp-mana"></div>
        </div>
        <div class="lp-selo-carga">
          <svg viewBox="-60 -60 120 120">
            <circle class="lp-carga-fundo" r="48"/>
            <circle class="lp-carga" r="48" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90)"/>
            ${glifo(7, 0, 0, 2.4, "lp-glifo lp-carga-runa")}
          </svg>
          <span class="lp-carga-txt"></span>
        </div>
      </div>
      <button type="button" class="lp-segurar lp-largo">${t("Jogo.canalizar.Segurar")}</button>`;
  }

  iniciar(el) {
    const btn = el.querySelector(".lp-segurar");
    const area = el.querySelector(".lp-canal-area");
    const segurar = ev => { ev.preventDefault(); if (!this.fim) this.segurando = true; };
    btn?.addEventListener("pointerdown", segurar);
    area?.addEventListener("pointerdown", segurar);
    window.addEventListener("pointerup", this._soltar);
    this._teclaSolta = ev => { if (ev.code === "Space") this.segurando = false; };
    document.addEventListener("keyup", this._teclaSolta, true);
    this.desenhar();
  }

  tecla(ev) {
    if (ev.code !== "Space") return false;
    if (!ev.repeat) this.segurando = true;
    return true;
  }

  quadro(dt) {
    // a simulação anda em passos fixos (DT), iguais aos que o mestre refaz na conferência
    this.acumulado += dt;
    while (this.acumulado >= DT && !this.l.fim) {
      this.l.passo(this.segurando);
      this.acumulado -= DT;
    }
    this.desenhar();
    if (this.l.fim === "ok") this.terminar(true);
  }

  desenhar() {
    const el = this.element;
    if (!el) return;
    const l = this.l;
    const f = el.querySelector(".lp-faixa");
    if (f) { f.style.height = `${l.faixa}%`; f.style.bottom = `${l.centro - l.faixa / 2}%`; f.classList.toggle("ativa", l.dentro); }
    const m = el.querySelector(".lp-mana");
    if (m) m.style.bottom = `${l.mana}%`;
    el.querySelector(".lp-carga")?.setAttribute("stroke-dasharray", `${l.carga} 100`);
    const txt = el.querySelector(".lp-carga-txt");
    if (txt) txt.textContent = `${Math.floor(l.carga)}%`;
  }

  async close(options) {
    window.removeEventListener("pointerup", this._soltar);
    if (this._teclaSolta) document.removeEventListener("keyup", this._teclaSolta, true);
    return super.close(options);
  }
}
