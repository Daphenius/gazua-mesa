// Gazua da Mesa — minigame da gazua.
// Cada pino tem um ponto certo na barra. Uma agulha corre de um lado para o outro:
// aperte (Espaço ou o botão) quando ela estiver no verde para levantar o pino.
// Errar desgasta a gazua; se ela quebrar, a tentativa falha.

import { t, esc, bonusArrombar } from "./dados.js";

const { ApplicationV2 } = foundry.applications.api;

export function parametros(f, actor) {
  const nivel = Math.clamp(Number(f.nivel) || 1, 1, 10);
  const { total, mult } = bonusArrombar(actor);
  const cd = Number(f.cd) || 15;
  return {
    pinos: Math.min(7, 2 + Math.ceil(nivel / 2)),
    largura: Math.clamp(22 + (total - (cd - 10)) * 2, 6, 45),   // % da barra
    velocidade: 0.55 + nivel * 0.08,                            // travessias por segundo
    vidas: 3 + (mult >= 2 ? 1 : 0),
    bonus: total
  };
}

export class Gazua extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["gazua-mesa", "lp-gazua"],
    window: { title: "GAZUAMESA.Gazua.Titulo", icon: "fa-solid fa-unlock-keyhole" },
    position: { width: 440 },
    actions: {
      levantar: Gazua.#levantar,
      desistir: Gazua.#desistir
    }
  };

  /** Abre o minigame e espera o resultado: true (abriu) ou false. */
  static jogar(opcoes) {
    return new Promise(resolve => new Gazua({ ...opcoes, resolve }).render({ force: true }));
  }

  constructor(options) {
    super(options);
    const p = options.parametros;
    this.p = p;
    this._resolve = options.resolve;
    this.nome = options.nome;
    this.pino = 0;
    this.vidas = p.vidas;
    this.fim = null;
    this.pos = 0;
    this.dir = 1;
    this.zona = this.#novaZona();
    this.vel = p.velocidade;
    this._tecla = ev => {
      if (ev.code !== "Space" || this.fim) return;
      if (ev.target?.closest?.("input, textarea, [contenteditable]")) return;
      ev.preventDefault(); ev.stopPropagation();
      Gazua.#levantar.call(this);
    };
  }

  #novaZona() {
    const l = this.p.largura;
    return { ini: Math.random() * (100 - l), largura: l };
  }

  async _renderHTML() {
    const p = this.p;
    const pinos = Array.from({ length: p.pinos }, (_, i) =>
      `<div class="lp-pino ${i < this.pino ? "ok" : i === this.pino ? "atual" : ""}"><span></span></div>`).join("");
    const vidas = Array.from({ length: p.vidas }, (_, i) =>
      `<i class="fa-solid fa-screwdriver ${i < this.vidas ? "" : "quebrada"}"></i>`).join("");
    return `
      <div class="lp-mg">
        <p class="lp-mg-nome">${esc(this.nome)}</p>
        <div class="lp-cilindro">${pinos}</div>
        <div class="lp-barra">
          <div class="lp-zona" style="left:${this.zona.ini}%;width:${this.zona.largura}%"></div>
          <div class="lp-agulha" style="left:${this.pos}%"></div>
        </div>
        <div class="lp-mg-info">
          <span class="lp-vidas" data-tooltip="${esc(t("Gazua.Vidas"))}">${vidas}</span>
          <span>${t("Gazua.Pino", { n: Math.min(this.pino + 1, p.pinos), total: p.pinos })}</span>
        </div>
        <p class="lp-dica">${t("Gazua.Dica")}</p>
        <div class="lp-botoes">
          <button type="button" data-action="levantar" class="lp-principal"><i class="fa-solid fa-arrow-up"></i> ${t("Gazua.Levantar")}</button>
          <button type="button" data-action="desistir"><i class="fa-solid fa-xmark"></i> ${t("Gazua.Desistir")}</button>
        </div>
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    document.addEventListener("keydown", this._tecla, true);
    let antes = performance.now();
    const passo = agora => {
      if (this.fim || !this.rendered) return;
      const dt = Math.min(0.05, (agora - antes) / 1000);
      antes = agora;
      this.pos += this.dir * this.vel * 100 * dt;
      if (this.pos >= 100) { this.pos = 100; this.dir = -1; }
      if (this.pos <= 0) { this.pos = 0; this.dir = 1; }
      const ag = this.element?.querySelector(".lp-agulha");
      if (ag) ag.style.left = `${this.pos}%`;
      this._raf = requestAnimationFrame(passo);
    };
    this._raf = requestAnimationFrame(passo);
  }

  static async #levantar() {
    if (this.fim) return;
    const z = this.zona;
    const acertou = this.pos >= z.ini && this.pos <= z.ini + z.largura;
    if (acertou) {
      this.pino += 1;
      if (this.pino >= this.p.pinos) return this.#terminar(true);
      this.zona = this.#novaZona();
      this.vel *= 1.06;
      this.pos = Math.random() < 0.5 ? 0 : 100;
      this.dir = this.pos === 0 ? 1 : -1;
    } else {
      this.vidas -= 1;
      if (this.vidas <= 0) return this.#terminar(false);
    }
    await this.render();
    if (!acertou) this.element?.querySelector(".lp-mg")?.classList.add("lp-tremer");
  }

  static #desistir() {
    this.#terminar(false);
  }

  async #terminar(sucesso) {
    if (this.fim) return;
    this.fim = sucesso ? "ok" : "falha";
    cancelAnimationFrame(this._raf);
    await this.render();
    this.element?.querySelector(".lp-mg")?.classList.add(sucesso ? "lp-abriu" : "lp-quebrou");
    ui.notifications[sucesso ? "info" : "warn"](t(sucesso ? "Gazua.Abriu" : "Gazua.Quebrou"));
    setTimeout(() => this.close(), 900);
  }

  async close(options) {
    document.removeEventListener("keydown", this._tecla, true);
    cancelAnimationFrame(this._raf);
    const resolve = this._resolve;
    this._resolve = null;
    // fechar a janela no meio conta como desistência
    resolve?.(this.fim === "ok");
    return super.close(options);
  }
}

