// Gazua da Mesa — minijogos de arrombar.
//
// Todos dividem a mesma base: cronômetro (tempo limite), resistência da gazua, mensagens,
// "como jogar" e o resultado (true = abriu). Cada jogo só cuida do próprio desenho e regra.
//
// Todos têm tema arcano: a fechadura é protegida por um encantamento que a gazua precisa desfazer.
//  - Anéis rúnicos (discos): gire os anéis até a runa-chave de cada um ficar sob o sigilo do topo.
//              Girar um anel pode arrastar o vizinho junto.
//  - Selo rúnico (runas): o selo acende uma sequência de runas; repita (em níveis altos, ao contrário).
//  - Fio de mana (labirinto): conduza uma centelha pelas linhas invisíveis da proteção até o núcleo;
//              cada choque revela uma barreira e abala a concentração.
//  - Sigilo de traço (sigilo): trace todas as linhas do sigilo sem passar duas vezes pela mesma.
//  - Cristais em harmonia (cristais): tocar um cristal inverte ele e os vizinhos; acenda todos.
//  - Canalizar (canalizar): segure para erguer a mana e mantenha-a dentro da faixa rúnica até encher o selo.

import { t, esc, bonusArrombar } from "./dados.js";
import { lerAjustes, jogosAtivos } from "./ajustes.js";

const { ApplicationV2 } = foundry.applications.api;

export const JOGOS = ["discos", "runas", "labirinto", "sigilo", "cristais", "canalizar"];

const sortear = lista => lista[Math.floor(Math.random() * lista.length)];

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

/**
 * Parâmetros comuns. A dificuldade do jogo é o nível da fechadura ajustado pela diferença
 * entre a CD e o bônus do personagem: personagens melhores enfrentam uma versão mais fácil.
 */
export function parametros(f, actor, { margem = 0, bonusGazua = 0 } = {}, tipo = "discos", ajustes = null) {
  const aj = { ...lerAjustes(tipo), ...(ajustes ?? {}) };
  const nivel = Math.clamp(Number(f.nivel) || 1, 1, 10);
  const { total, mult } = bonusArrombar(actor);
  const cd = Number(f.cd) || 15;
  const dificuldade = Math.clamp(nivel + Math.round((cd - 10 - total - bonusGazua) / 4) + (Number(aj.ajuste) || 0), 1, 10);
  // tempo próprio do minijogo (se configurado) ou o da fechadura
  const base = Math.max(0, Number(aj.tempo) > 0 ? Number(aj.tempo) : Number(f.tempo) || 0);
  const extra = 2 * Math.max(0, margem) + 2 * Math.max(0, bonusGazua);
  return {
    nivel, dificuldade, bonus: total, expertise: mult >= 2,
    tempo: base > 0 ? base + extra : 0,     // segundos; 0 = sem limite
    extra, aj
  };
}

export function escolherJogo(f) {
  const j = f.minijogo;
  return JOGOS.includes(j) ? j : sortear(jogosAtivos());
}

/** Abre o minijogo e espera o resultado: true (abriu) ou false. */
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
    this.vidasMax = this.#comExtra(this.resistencia());
    this.vidas = this.vidasMax;
    this.restante = this.p.tempo;
    this._tecla = ev => {
      if (this.fim || ev.target?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (this.tecla(ev) === true) { ev.preventDefault(); ev.stopPropagation(); }
    };
  }

  get title() { return t(`Jogo.${this.constructor.TIPO}.Nome`); }

  #comExtra(n) { return n > 0 ? Math.max(1, n + (Number(this.aj?.concentracao) || 0)) : 0; }
  ajustarResistencia() { this.vidasMax = this.vidas = this.#comExtra(this.resistencia()); }

  /** Quantos erros a gazua aguenta. */
  resistencia() { return 3 + (this.p.expertise ? 1 : 0); }
  corpo() { return ""; }
  iniciar() {}
  tecla() { return false; }
  quadro() {}

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
        if (this.p.tempo > 0) {
          this.restante = Math.max(0, this.restante - dt);
          this.desenharRelogio();
          if (this.restante <= 0) this.terminar(false, t("Jogo.Tempo"));
        }
      }
      this._raf = requestAnimationFrame(passo);
    };
    this.desenharRelogio();
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
    this.element?.querySelectorAll(".lp-vidas i").forEach((i, k) => i.classList.toggle("quebrada", k >= this.vidas));
  }

  tremer() {
    const palco = this.element?.querySelector(".lp-palco");
    if (!palco) return;
    palco.classList.remove("lp-tremer");
    void palco.offsetWidth;
    palco.classList.add("lp-tremer");
  }

  /** Erro: desgasta a gazua. Devolve true se a gazua quebrou. */
  perderVida(texto) {
    this.vidas -= 1;
    this.atualizarVidas();
    this.tremer();
    if (this.vidas <= 0) { this.terminar(false, t("Jogo.Quebrou")); return true; }
    this.mensagem(texto, "erro");
    return false;
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
    resolve?.(this.fim === "ok");   // fechar no meio conta como desistência
    return super.close(options);
  }
}

// ======================================================================
// Discos: alinhe os entalhes no canal da trava
// ======================================================================

const POS = 8;          // posições por volta (45°)

export class Discos extends MiniJogo {
  static TIPO = "discos";

  constructor(options) {
    super(options);
    const d = this.p.dificuldade;
    this.n = Math.min(Number(this.aj.maxAneis) || 5, 5, 2 + Math.ceil(d / 3));
    this.pos = Array(this.n).fill(0);
    this.ang = Array(this.n).fill(0);     // ângulo acumulado (para a animação não voltar)
    this.sel = this.n - 1;
    this.glifos = Array.from({ length: this.n }, () => Array.from({ length: POS }, () => Math.floor(Math.random() * GLIFOS.length)));
    // ligações: girar o disco i também gira estes
    const chance = 0.2 + d * 0.06;
    this.ligacoes = Array.from({ length: this.n }, (_, i) => {
      const l = [i];
      if (Math.random() < chance) l.push(i === this.n - 1 ? i - 1 : i + 1);
      return l;
    });
    if (d >= 4 && this.ligacoes.every(l => l.length === 1)) this.ligacoes[0].push(1);
    if (this.aj.ligacoes === false) this.ligacoes = this.ligacoes.map((_, i) => [i]);
    // embaralha a partir do resolvido: sempre tem solução
    do {
      for (let k = 0; k < 4 + d; k++) this.#girar(Math.floor(Math.random() * this.n), Math.random() < 0.5 ? 1 : -1, false);
    } while (this.resolvido);
    this.ang = this.pos.map(p => p * 45);
  }

  resistencia() { return 0; }   // aqui não há o que quebrar: só o tempo conta

  get resolvido() { return this.pos.every(p => p === 0); }

  #girar(i, dir, animar = true) {
    for (const j of this.ligacoes[i]) {
      this.pos[j] = (this.pos[j] + dir + POS) % POS;
      if (animar) this.ang[j] += dir * 45;
    }
  }

  raio(i) { return 48 + i * 24; }

  corpo() {
    const discos = Array.from({ length: this.n }, (_, i) => {
      const r = this.raio(i);
      // runas gravadas em volta do anel; a da posição 0 é a runa-chave
      const runas = Array.from({ length: POS }, (_, k) => {
        const a = (k * 45 - 90) * Math.PI / 180;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        return `<g transform="rotate(${k * 45} ${x} ${y})">${glifo(this.glifos[i][k], x, y, 0.62, k === 0 ? "lp-glifo lp-chave-runa" : "lp-glifo")}</g>`;
      }).join("");
      return `
        <g class="lp-disco" data-i="${i}">
          <circle class="lp-disco-aro" r="${r}"/>
          ${runas}
        </g>`;
    }).join("");
    const R = this.raio(this.n - 1) + 18;
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
      for (let i = 0; i < this.n; i++) {
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
      svg.querySelectorAll(".lp-disco").forEach((g, k) => g.classList.toggle("ligado", i != null && this.ligacoes[i].includes(k) && k !== i));
    });
    svg.addEventListener("pointerleave", () => svg.querySelectorAll(".lp-disco.ligado").forEach(g => g.classList.remove("ligado")));
    for (const b of el.querySelectorAll("[data-lado]")) b.addEventListener("click", () => this.acao(Number(b.dataset.lado)));
    this.desenhar();
  }

  acao(dir) {
    if (this.fim) return;
    this.#girar(this.sel, dir);
    this.desenhar();
    const certos = this.pos.filter(p => p === 0).length;
    if (this.resolvido) return this.terminar(true);
    this.mensagem(t("Jogo.discos.Alinhados", { n: certos, total: this.n }));
  }

  desenhar() {
    const el = this.element;
    if (!el) return;
    el.querySelectorAll(".lp-disco").forEach((g, i) => {
      g.style.transform = `rotate(${this.ang[i]}deg)`;
      g.classList.toggle("sel", i === this.sel);
      g.classList.toggle("certo", this.pos[i] === 0);
    });
    const s = el.querySelector(".lp-disco-sel");
    if (s) s.textContent = t("Jogo.discos.Disco", { n: this.n - this.sel, total: this.n });
  }

  tecla(ev) {
    const k = ev.code;
    if (k === "ArrowUp" || k === "KeyW") { this.sel = Math.min(this.n - 1, this.sel + 1); this.desenhar(); return true; }
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
// Runas: repita a sequência do selo
// ======================================================================


export class Runas extends MiniJogo {
  static TIPO = "runas";

  constructor(options) {
    super(options);
    const d = this.p.dificuldade;
    this.qtd = d >= 6 ? 8 : 6;
    this.tam = 3 + Math.ceil(d / 2);
    const desde = Number(this.aj.inverterDesde ?? 7);
    this.invertida = desde > 0 && d >= desde;
    this.ritmo = Math.max(300, (760 - d * 40) / (Number(this.aj.ritmo) || 1));   // ms por runa
    this.seq = Array.from({ length: this.tam }, () => Math.floor(Math.random() * this.qtd));
    // quais runas aparecem no selo (sorteadas a cada tentativa)
    this.simbolos = [...GLIFOS.keys()].sort(() => Math.random() - 0.5).slice(0, this.qtd);
    this.entrada = [];
    this.mostrando = false;
  }

  get esperado() { return this.invertida ? [...this.seq].reverse() : this.seq; }

  corpo() {
    const R = 104;
    const runas = Array.from({ length: this.qtd }, (_, i) => {
      const a = (i / this.qtd) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * R, y = Math.sin(a) * R;
      return `<button type="button" class="lp-runa" data-i="${i}" style="left:calc(50% + ${x}px);top:calc(50% + ${y}px)">
        <svg viewBox="-2 -2 14 20">${glifo(this.simbolos[i], 5, 8)}</svg></button>`;
    }).join("");
    return `
      <div class="lp-selo-runas">
        <div class="lp-circulo"></div>
        ${runas}
        <div class="lp-centro">
          <div class="lp-contas">${this.seq.map(() => "<span></span>").join("")}</div>
          <small>${this.invertida ? t("Jogo.runas.AoContrario") : ""}</small>
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
    this.entrada = [];
    this.marcarContas();
    this.element?.querySelector(".lp-selo-runas")?.classList.add("mostrando");
    this.mensagem(t("Jogo.runas.Observe"));
    const espera = ms => new Promise(r => setTimeout(r, ms));
    for (const i of this.seq) {
      if (this.fim || !this.rendered) return;
      this.acender(i, this.ritmo * 0.7);
      await espera(this.ritmo);
    }
    this.mostrando = false;
    this.element?.querySelector(".lp-selo-runas")?.classList.remove("mostrando");
    this.mensagem(t(this.invertida ? "Jogo.runas.RepitaInvertido" : "Jogo.runas.Repita"));
  }

  acender(i, ms) {
    const b = this.element?.querySelector(`.lp-runa[data-i="${i}"]`);
    if (!b) return;
    b.classList.add("acesa");
    setTimeout(() => b.classList.remove("acesa"), ms);
  }

  marcarContas() {
    this.element?.querySelectorAll(".lp-contas span").forEach((s, k) => s.classList.toggle("on", k < this.entrada.length));
  }

  tocar(i) {
    if (this.fim || this.mostrando) return;
    this.acender(i, 250);
    const certo = this.esperado[this.entrada.length];
    if (i !== certo) {
      if (this.perderVida(t("Jogo.runas.Errou"))) return;
      setTimeout(() => this.mostrar(), 900);
      return;
    }
    this.entrada.push(i);
    this.marcarContas();
    if (this.entrada.length === this.seq.length) this.terminar(true);
  }

  tecla(ev) {
    const n = Number(ev.key);
    if (n >= 1 && n <= this.qtd) { this.tocar(n - 1); return true; }
    return false;
  }
}

// ======================================================================
// Mecanismo às cegas: tateie o caminho até a trava
// ======================================================================

export class Labirinto extends MiniJogo {
  static TIPO = "labirinto";

  constructor(options) {
    super(options);
    const d = this.p.dificuldade;
    this.s = Math.min(Number(this.aj.maxTamanho) || 10, 5 + Math.floor(d / 2));
    this.#gerar();
    this.vistas = new Set();     // paredes já reveladas: "r,c,dr,dc"
    this.rastro = new Set([this.#chave(this.pos)]);
    // a resistência depende do tamanho, que só existe agora
    this.ajustarResistencia();
  }

  resistencia() { return this.s ? Math.round(this.s * 1.2) + (this.p.expertise ? 2 : 0) : 0; }

  #chave(p) { return `${p.r},${p.c}`; }

  #gerar() {
    const s = this.s;
    // parede à direita (dir) e embaixo (baixo) de cada casa; tudo fechado no começo
    this.dir = Array.from({ length: s }, () => Array(s).fill(true));
    this.baixo = Array.from({ length: s }, () => Array(s).fill(true));
    const visto = Array.from({ length: s }, () => Array(s).fill(false));
    const pilha = [{ r: Math.floor(Math.random() * s), c: 0 }];
    visto[pilha[0].r][0] = true;
    while (pilha.length) {
      const atual = pilha.at(-1);
      const viz = [[0, 1], [1, 0], [0, -1], [-1, 0]]
        .map(([dr, dc]) => ({ r: atual.r + dr, c: atual.c + dc }))
        .filter(v => v.r >= 0 && v.c >= 0 && v.r < s && v.c < s && !visto[v.r][v.c]);
      if (!viz.length) { pilha.pop(); continue; }
      const v = sortear(viz);
      if (v.r === atual.r) this.dir[atual.r][Math.min(v.c, atual.c)] = false;
      else this.baixo[Math.min(v.r, atual.r)][atual.c] = false;
      visto[v.r][v.c] = true;
      pilha.push(v);
    }
    this.pos = { r: Math.floor(s / 2), c: 0 };
    this.alvo = { r: Math.floor(Math.random() * s), c: s - 1 };
  }

  /** Há parede saindo da casa p na direção (dr, dc)? */
  parede(p, dr, dc) {
    const r = p.r + dr, c = p.c + dc;
    if (r < 0 || c < 0 || r >= this.s || c >= this.s) return true;
    if (dc === 1) return this.dir[p.r][p.c];
    if (dc === -1) return this.dir[p.r][c];
    if (dr === 1) return this.baixo[p.r][p.c];
    return this.baixo[r][p.c];
  }

  corpo() {
    const L = 36, s = this.s, W = s * L;
    return `
      <svg class="lp-lab-svg" viewBox="-16 -6 ${W + 44} ${W + 12}">
        <rect class="lp-lab-fundo" x="0" y="0" width="${W}" height="${W}" rx="6"/>
        <g class="lp-lab-pontos">${Array.from({ length: s * s }, (_, k) =>
          `<circle cx="${(k % s) * L + L / 2}" cy="${Math.floor(k / s) * L + L / 2}" r="1.3"/>`).join("")}</g>
        <g class="lp-lab-rastro"></g>
        <g class="lp-lab-paredes"></g>
        <circle class="lp-lab-buraco" cx="-6" cy="${this.pos.r * L + L / 2}" r="7"/>
        <g class="lp-lab-trava" transform="translate(${W + 10} ${this.alvo.r * L + L / 2})">
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
      b.addEventListener("click", () => { const [dr, dc] = b.dataset.d.split(",").map(Number); this.mover(dr, dc); });
    }
    this.desenhar();
  }

  mover(dr, dc) {
    if (this.fim) return;
    const p = this.pos;
    if (this.parede(p, dr, dc)) {
      // na última coluna, a direita na linha da trava é a saída
      if (dc === 1 && p.c === this.s - 1 && p.r === this.alvo.r) return this.terminar(true);
      this.vistas.add(`${p.r},${p.c},${dr},${dc}`);
      this.desenhar();
      this.perderVida(t("Jogo.labirinto.Bateu"));
      return;
    }
    this.pos = { r: p.r + dr, c: p.c + dc };
    this.rastro.add(this.#chave(this.pos));
    this.desenhar();
    if (this.pos.c === this.s - 1 && this.pos.r === this.alvo.r) this.mensagem(t("Jogo.labirinto.Perto"), "ok");
    else this.mensagem(t("Jogo.labirinto.Andando"));
  }

  desenhar() {
    const el = this.element;
    if (!el) return;
    const L = 36;
    const rastro = this.aj.mostrarRastro === false ? [] : [...this.rastro];
    el.querySelector(".lp-lab-rastro").innerHTML = rastro.map(k => {
      const [r, c] = k.split(",").map(Number);
      return `<rect x="${c * L + 3}" y="${r * L + 3}" width="${L - 6}" height="${L - 6}" rx="5"/>`;
    }).join("");
    el.querySelector(".lp-lab-paredes").innerHTML = [...this.vistas].map(k => {
      const [r, c, dr, dc] = k.split(",").map(Number);
      const x = c * L, y = r * L;
      if (dc === 1) return `<line x1="${x + L}" y1="${y}" x2="${x + L}" y2="${y + L}"/>`;
      if (dc === -1) return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + L}"/>`;
      if (dr === 1) return `<line x1="${x}" y1="${y + L}" x2="${x + L}" y2="${y + L}"/>`;
      return `<line x1="${x}" y1="${y}" x2="${x + L}" y2="${y}"/>`;
    }).join("");
    const ponta = el.querySelector(".lp-lab-ponta");
    ponta.setAttribute("cx", this.pos.c * L + L / 2);
    ponta.setAttribute("cy", this.pos.r * L + L / 2);
  }

  tecla(ev) {
    const mapa = { ArrowUp: [-1, 0], KeyW: [-1, 0], ArrowDown: [1, 0], KeyS: [1, 0], ArrowLeft: [0, -1], KeyA: [0, -1], ArrowRight: [0, 1], KeyD: [0, 1] };
    const d = mapa[ev.code];
    if (!d) return false;
    this.mover(...d);
    return true;
  }
}

// ======================================================================
// Sigilo de traço: percorra todas as linhas sem repetir nenhuma
// ======================================================================

export class Sigilo extends MiniJogo {
  static TIPO = "sigilo";

  constructor(options) {
    super(options);
    const d = this.p.dificuldade;
    this.nNos = Math.min(Number(this.aj.maxRunas) || 10, 10, 5 + Math.floor(d / 2));
    const alvo = this.nNos + 1 + Math.floor(d / 2);
    // posições num círculo, com um leve desvio para não parecer régua
    this.nos = Array.from({ length: this.nNos }, (_, i) => {
      const a = (i / this.nNos) * Math.PI * 2 - Math.PI / 2;
      const r = 112 + (Math.random() * 16 - 8);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
    // o sigilo é um caminho aleatório: assim sempre dá para traçar tudo de uma vez
    let tentativa = 0;
    do {
      this.arestas = [];
      let atual = Math.floor(Math.random() * this.nNos);
      this.inicio = atual;
      for (let k = 0; k < alvo; k++) {
        const opcoes = [...this.nos.keys()].filter(j => j !== atual && !this.#tem(atual, j));
        if (!opcoes.length) break;
        const prox = sortear(opcoes);
        this.arestas.push([atual, prox]);
        atual = prox;
      }
    } while (this.arestas.length < alvo - 1 && ++tentativa < 20);
    this.usadas = new Set();
    this.atual = null;
  }

  #tem(a, b) { return this.arestas.some(([x, y]) => (x === a && y === b) || (x === b && y === a)); }
  #indice(a, b) { return this.arestas.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a)); }
  grau(i) { return this.arestas.filter(([x, y]) => x === i || y === i).length; }

  corpo() {
    const R = 140;
    const linhas = this.arestas.map(([a, b], k) => {
      const A = this.nos[a], B = this.nos[b];
      return `<line class="lp-traco" data-k="${k}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`;
    }).join("");
    // runas sem nenhuma linha não aparecem (só confundiriam)
    const dica = this.aj.dicaImpar === true;
    const nos = this.nos.map((n, i) => this.grau(i) === 0 ? "" : `
      <g class="lp-no ${dica && this.grau(i) % 2 ? "impar" : ""}" data-i="${i}" transform="translate(${n.x} ${n.y})">
        <circle r="13"/>${glifo(i, 0, 0, 0.7)}
      </g>`).join("");
    return `
      <svg class="lp-sigilo-svg" viewBox="${-R} ${-R} ${R * 2} ${R * 2}">
        <circle class="lp-sigilo-aro" r="${R - 6}"/>
        <g class="lp-tracos">${linhas}</g>
        ${nos}
      </svg>
      <div class="lp-sigilo-info"><span class="lp-sigilo-cont"></span>
        <button type="button" class="lp-mini" data-lp="recomecar"><i class="fa-solid fa-rotate"></i> ${t("Jogo.sigilo.Recomecar")}</button></div>`;
  }

  iniciar(el) {
    for (const g of el.querySelectorAll(".lp-no")) g.addEventListener("click", () => this.tocar(Number(g.dataset.i)));
    el.querySelector("[data-lp=recomecar]")?.addEventListener("click", () => {
      if (this.fim) return;
      this.usadas.clear(); this.atual = null; this.desenhar();
      this.mensagem(t("Jogo.sigilo.Comeco"));
    });
    this.desenhar();
  }

  tocar(i) {
    if (this.fim) return;
    if (this.atual === null) {
      this.atual = i;
      this.desenhar();
      return this.mensagem(t("Jogo.sigilo.Comecou"));
    }
    if (i === this.atual) return;
    const k = this.#indice(this.atual, i);
    if (k < 0 || this.usadas.has(k)) {
      this.perderVida(t(k < 0 ? "Jogo.sigilo.SemLinha" : "Jogo.sigilo.Repetida"));
      return;
    }
    this.usadas.add(k);
    this.atual = i;
    this.desenhar();
    if (this.usadas.size === this.arestas.length) return this.terminar(true);
    // sem saída: ainda faltam linhas, mas nenhuma livre parte daqui
    const livre = this.arestas.some(([a, b], j) => !this.usadas.has(j) && (a === i || b === i));
    if (!livre) {
      if (this.perderVida(t("Jogo.sigilo.Preso"))) return;
      this.usadas.clear(); this.atual = null;
      this.desenhar();
      return;
    }
    this.mensagem(t("Jogo.sigilo.Faltam", { n: this.arestas.length - this.usadas.size }));
  }

  desenhar() {
    const el = this.element;
    if (!el) return;
    el.querySelectorAll(".lp-traco").forEach(l => l.classList.toggle("feito", this.usadas.has(Number(l.dataset.k))));
    el.querySelectorAll(".lp-no").forEach(g => g.classList.toggle("atual", Number(g.dataset.i) === this.atual));
    const c = el.querySelector(".lp-sigilo-cont");
    if (c) c.textContent = t("Jogo.sigilo.Contagem", { n: this.usadas.size, total: this.arestas.length });
  }
}

// ======================================================================
// Cristais em harmonia: tocar um cristal inverte ele e os vizinhos
// ======================================================================

export class Cristais extends MiniJogo {
  static TIPO = "cristais";

  constructor(options) {
    super(options);
    const d = this.p.dificuldade;
    this.g = Math.min(Number(this.aj.maxGrade) || 5, d <= 3 ? 3 : d <= 7 ? 4 : 5);
    this.luz = Array(this.g * this.g).fill(true);
    // parte do resolvido e toca alguns cristais: sempre tem solução
    this.solucao = new Set();
    do {
      for (let k = 0; k < 3 + d; k++) {
        const i = Math.floor(Math.random() * this.luz.length);
        this.#inverter(i);
        if (this.solucao.has(i)) this.solucao.delete(i); else this.solucao.add(i);
      }
    } while (this.luz.every(Boolean));
    this.toques = 0;
  }

  resistencia() { return 0; }

  #vizinhos(i) {
    const g = this.g, r = Math.floor(i / g), c = i % g;
    return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dr, dc]) => [r + dr, c + dc])
      .filter(([a, b]) => a >= 0 && b >= 0 && a < g && b < g)
      .map(([a, b]) => a * g + b);
  }

  #inverter(i) {
    for (const j of this.#vizinhos(i)) this.luz[j] = !this.luz[j];
  }

  corpo() {
    const cel = Array.from({ length: this.g * this.g }, (_, i) =>
      `<button type="button" class="lp-cristal" data-i="${i}"><svg viewBox="-2 -2 14 20">${glifo(i, 5, 8)}</svg></button>`).join("");
    return `<div class="lp-cristais" style="grid-template-columns:repeat(${this.g}, 1fr)">${cel}</div>
      <p class="lp-cristais-info"></p>`;
  }

  iniciar(el) {
    for (const b of el.querySelectorAll(".lp-cristal")) b.addEventListener("click", () => this.tocar(Number(b.dataset.i)));
    this.desenhar();
  }

  tocar(i) {
    if (this.fim) return;
    this.#inverter(i);
    this.toques += 1;
    this.desenhar();
    if (this.luz.every(Boolean)) this.terminar(true);
  }

  desenhar() {
    const el = this.element;
    if (!el) return;
    el.querySelectorAll(".lp-cristal").forEach((b, i) => b.classList.toggle("aceso", this.luz[i]));
    const info = el.querySelector(".lp-cristais-info");
    if (info) info.textContent = t("Jogo.cristais.Contagem", { n: this.luz.filter(Boolean).length, total: this.luz.length, toques: this.toques });
  }
}

// ======================================================================
// Canalizar: mantenha a mana dentro da faixa rúnica até encher o selo
// ======================================================================

export class Canalizar extends MiniJogo {
  static TIPO = "canalizar";

  constructor(options) {
    super(options);
    const d = this.p.dificuldade;
    this.faixa = Math.clamp((36 - d * 2) * (Number(this.aj.largura) || 1), 10, 60);   // altura da faixa (%)
    this.velFaixa = (8 + d * 2.5) * (Number(this.aj.velocidade) || 1);                 // quanto a faixa anda (%/s)
    this.centro = 50;
    this.destino = 50;
    this.troca = 0;
    this.mana = 10;                                    // posição da mana (%)
    this.vel = 0;
    this.carga = 0;                                    // quanto o selo já encheu (%)
    this.segurando = false;
    this._soltar = () => { this.segurando = false; };
  }

  resistencia() { return 0; }

  get dentro() { return Math.abs(this.mana - this.centro) <= this.faixa / 2; }

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
    // a faixa passeia pela coluna
    this.troca -= dt;
    if (this.troca <= 0) {
      this.destino = this.faixa / 2 + Math.random() * (100 - this.faixa);
      this.troca = 1 + Math.random() * 1.6;
    }
    const passo = this.velFaixa * dt;
    this.centro += Math.clamp(this.destino - this.centro, -passo, passo);
    // a mana sobe enquanto segura e cai quando solta (com um pouco de embalo)
    const alvoVel = this.segurando ? 48 : -40;
    this.vel += (alvoVel - this.vel) * Math.min(1, dt * 7);
    this.mana += this.vel * dt;
    if (this.mana <= 0) { this.mana = 0; this.vel = 0; }
    if (this.mana >= 100) { this.mana = 100; this.vel = 0; }
    // dentro da faixa o selo enche; fora, esvazia
    this.carga = Math.clamp(this.carga + (this.dentro ? 16 : -9) * dt, 0, 100);
    this.desenhar();
    if (this.carga >= 100) this.terminar(true);
  }

  desenhar() {
    const el = this.element;
    if (!el) return;
    const f = el.querySelector(".lp-faixa");
    if (f) { f.style.height = `${this.faixa}%`; f.style.bottom = `${this.centro - this.faixa / 2}%`; f.classList.toggle("ativa", this.dentro); }
    const m = el.querySelector(".lp-mana");
    if (m) m.style.bottom = `${this.mana}%`;
    el.querySelector(".lp-carga")?.setAttribute("stroke-dasharray", `${this.carga} 100`);
    const txt = el.querySelector(".lp-carga-txt");
    if (txt) txt.textContent = `${Math.floor(this.carga)}%`;
  }

  async close(options) {
    window.removeEventListener("pointerup", this._soltar);
    if (this._teclaSolta) document.removeEventListener("keyup", this._teclaSolta, true);
    return super.close(options);
  }
}
