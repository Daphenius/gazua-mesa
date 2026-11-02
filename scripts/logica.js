// Gazua da Mesa — regras dos minijogos, sem nada do Foundry.
//
// O jogador e o mestre rodam este mesmo código. O mestre sorteia a semente (seed) e a manda ao
// jogador; o jogador monta o jogo a partir dela, joga e devolve as jogadas que fez. O mestre
// monta o mesmo jogo com a mesma semente, refaz as jogadas e decide se a fechadura abriu.
// Por isso aqui nada usa Math.random: todo sorteio sai do gerador criado a partir da semente,
// e a ordem dos sorteios é a mesma dos dois lados.

import { JOGOS } from "./dados.js";

export { JOGOS };

export const NUM_GLIFOS = 12;     // quantas runas existem para desenhar (jogos.js)
export const POS = 8;             // posições por volta nos anéis (45°)
export const DT = 1 / 60;         // passo fixo da simulação do Canalizar (segundos)
const MAX_JOGADAS = 5000;         // jogadas aceitas na conferência
const MAX_TICKS = 60 * 1200;      // 20 minutos de Canalizar

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const inteiro = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Semente nova (inteiro de 32 bits). */
export function novaSemente() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 2 ** 32);
}

/** Gerador de números (mulberry32): a mesma semente dá sempre a mesma sequência, entre 0 e 1. */
export function criarSorteio(semente) {
  let a = (Number(semente) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Parâmetros do jogo. A dificuldade é o nível da fechadura ajustado pela diferença entre a CD e o
 * bônus do personagem: personagens melhores enfrentam uma versão mais fácil.
 * `bonusAtor` = { total, mult } de bonusArrombar(); `aj` = ajustes do minijogo.
 */
export function calcularParametros(f, bonusAtor, { margem = 0, bonusGazua = 0 } = {}, aj = {}) {
  const nivel = clamp(Number(f.nivel) || 1, 1, 10);
  const total = Number(bonusAtor?.total) || 0;
  const cd = Number(f.cd) || 15;
  const dificuldade = clamp(nivel + Math.round((cd - 10 - total - bonusGazua) / 4) + (Number(aj.ajuste) || 0), 1, 10);
  // tempo próprio do minijogo (se configurado) ou o da fechadura
  const base = Math.max(0, Number(aj.tempo) > 0 ? Number(aj.tempo) : Number(f.tempo) || 0);
  const extra = 2 * Math.max(0, margem) + 2 * Math.max(0, bonusGazua);
  return {
    nivel, dificuldade, bonus: total, expertise: (Number(bonusAtor?.mult) || 0) >= 2,
    tempo: base > 0 ? base + extra : 0,     // segundos; 0 = sem limite
    extra, aj: { ...aj }
  };
}

// ======================================================================
// Base
// ======================================================================

class Logica {
  constructor(p, sorteio) {
    this.p = p;
    this.aj = p.aj ?? {};
    this.rng = sorteio;
    this.fim = null;          // null | "ok" | "falha"
    this.motivo = null;       // chave i18n do fim (ex.: "Jogo.Quebrou")
    this.jogadas = [];
    this.vidasMax = this.vidas = 0;   // preenchidas por criarLogica()
  }

  get d() { return this.p.dificuldade; }
  int(n) { return Math.floor(this.rng() * n); }
  sortear(lista) { return lista[this.int(lista.length)]; }
  embaralhar(lista) {
    const l = [...lista];
    for (let i = l.length - 1; i > 0; i--) { const j = this.int(i + 1); [l[i], l[j]] = [l[j], l[i]]; }
    return l;
  }

  /** Quantos erros a gazua aguenta (0 = não há erro, só o tempo conta). */
  resistencia() { return 3 + (this.p.expertise ? 1 : 0); }

  ganhar() { if (!this.fim) this.fim = "ok"; }

  /** Erro: desgasta a gazua. Devolve true se ela quebrou. */
  perderVida() {
    if (this.vidasMax <= 0) return false;
    this.vidas -= 1;
    if (this.vidas <= 0) { this.fim = "falha"; this.motivo = "Jogo.Quebrou"; return true; }
    return false;
  }

  /**
   * Faz uma jogada. Devolve null (jogada ignorada) ou um evento para a tela:
   * { chave, dados, classe, erro }. Depois, `fim` diz se o jogo acabou.
   */
  jogar(jogada) {
    if (this.fim) return null;
    const ev = this.aplicar(jogada);
    if (ev !== null) this.jogadas.push(jogada);
    return ev;
  }

  aplicar() { return null; }

  /** O que o jogador manda ao mestre. */
  get registro() { return this.jogadas; }

  /** Refaz as jogadas recebidas (no mestre). */
  reproduzir(registro) {
    if (!Array.isArray(registro) || registro.length > MAX_JOGADAS) return;
    for (const j of registro) {
      if (this.fim) break;
      this.jogar(j);
    }
  }
}

// ======================================================================
// Anéis rúnicos (discos)
// ======================================================================

class LogicaDiscos extends Logica {
  constructor(p, rng) {
    super(p, rng);
    const d = this.d;
    this.n = Math.min(Number(this.aj.maxAneis) || 5, 5, 2 + Math.ceil(d / 3));
    this.pos = Array(this.n).fill(0);
    this.glifos = Array.from({ length: this.n }, () => Array.from({ length: POS }, () => this.int(NUM_GLIFOS)));
    // ligações: girar o anel i também gira estes
    const chance = 0.2 + d * 0.06;
    this.ligacoes = Array.from({ length: this.n }, (_, i) => {
      const l = [i];
      if (this.rng() < chance) l.push(i === this.n - 1 ? i - 1 : i + 1);
      return l;
    });
    if (d >= 4 && this.ligacoes.every(l => l.length === 1)) this.ligacoes[0].push(1);
    if (this.aj.ligacoes === false) this.ligacoes = this.ligacoes.map((_, i) => [i]);
    // embaralha a partir do resolvido: sempre tem solução
    do {
      for (let k = 0; k < 4 + d; k++) this.girar(this.int(this.n), this.rng() < 0.5 ? 1 : -1);
    } while (this.resolvido);
  }

  resistencia() { return 0; }
  get resolvido() { return this.pos.every(p => p === 0); }

  girar(i, dir) {
    for (const j of this.ligacoes[i]) this.pos[j] = (this.pos[j] + dir + POS) % POS;
  }

  /** jogada = [anel, direção (1 ou -1)] */
  aplicar(jogada) {
    const [i, dir] = Array.isArray(jogada) ? jogada : [];
    if (!inteiro(i, 0, this.n - 1) || (dir !== 1 && dir !== -1)) return null;
    this.girar(i, dir);
    if (this.resolvido) { this.ganhar(); return {}; }
    return { chave: "Jogo.discos.Alinhados", dados: { n: this.pos.filter(p => p === 0).length, total: this.n } };
  }
}

// ======================================================================
// Selo rúnico (runas)
// ======================================================================

class LogicaRunas extends Logica {
  constructor(p, rng) {
    super(p, rng);
    const d = this.d;
    this.qtd = d >= 6 ? 8 : 6;
    this.tam = 3 + Math.ceil(d / 2);
    const desde = Number(this.aj.inverterDesde ?? 7);
    this.invertida = desde > 0 && d >= desde;
    this.ritmo = Math.max(300, (760 - d * 40) / (Number(this.aj.ritmo) || 1));   // ms por runa
    this.seq = Array.from({ length: this.tam }, () => this.int(this.qtd));
    // quais runas aparecem no selo
    this.simbolos = this.embaralhar([...Array(NUM_GLIFOS).keys()]).slice(0, this.qtd);
    this.entrada = [];
  }

  get esperado() { return this.invertida ? [...this.seq].reverse() : this.seq; }

  /** jogada = índice da runa tocada */
  aplicar(i) {
    if (!inteiro(i, 0, this.qtd - 1)) return null;
    if (i !== this.esperado[this.entrada.length]) {
      this.entrada = [];          // o selo mostra a sequência de novo
      this.perderVida();
      return { chave: "Jogo.runas.Errou", classe: "erro", erro: true };
    }
    this.entrada.push(i);
    if (this.entrada.length === this.seq.length) this.ganhar();
    return {};
  }
}

// ======================================================================
// Fio de mana (labirinto)
// ======================================================================

const DIRECOES = [[-1, 0], [1, 0], [0, -1], [0, 1]];

class LogicaLabirinto extends Logica {
  constructor(p, rng) {
    super(p, rng);
    this.s = Math.min(Number(this.aj.maxTamanho) || 10, 5 + Math.floor(this.d / 2));
    this.gerar();
    this.vistas = new Set();     // paredes já reveladas: "r,c,dr,dc"
    this.rastro = new Set([`${this.pos.r},${this.pos.c}`]);
  }

  resistencia() { return Math.round(this.s * 1.2) + (this.p.expertise ? 2 : 0); }

  gerar() {
    const s = this.s;
    // parede à direita (dir) e embaixo (baixo) de cada casa; tudo fechado no começo
    this.dir = Array.from({ length: s }, () => Array(s).fill(true));
    this.baixo = Array.from({ length: s }, () => Array(s).fill(true));
    const visto = Array.from({ length: s }, () => Array(s).fill(false));
    const pilha = [{ r: this.int(s), c: 0 }];
    visto[pilha[0].r][0] = true;
    while (pilha.length) {
      const atual = pilha.at(-1);
      const viz = [[0, 1], [1, 0], [0, -1], [-1, 0]]
        .map(([dr, dc]) => ({ r: atual.r + dr, c: atual.c + dc }))
        .filter(v => v.r >= 0 && v.c >= 0 && v.r < s && v.c < s && !visto[v.r][v.c]);
      if (!viz.length) { pilha.pop(); continue; }
      const v = this.sortear(viz);
      if (v.r === atual.r) this.dir[atual.r][Math.min(v.c, atual.c)] = false;
      else this.baixo[Math.min(v.r, atual.r)][atual.c] = false;
      visto[v.r][v.c] = true;
      pilha.push(v);
    }
    this.pos = { r: Math.floor(s / 2), c: 0 };
    this.alvo = { r: this.int(s), c: s - 1 };
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

  /** jogada = [dr, dc] */
  aplicar(jogada) {
    const [dr, dc] = Array.isArray(jogada) ? jogada : [];
    if (!DIRECOES.some(([a, b]) => a === dr && b === dc)) return null;
    const p = this.pos;
    if (this.parede(p, dr, dc)) {
      // na última coluna, a direita na linha da trava é a saída
      if (dc === 1 && p.c === this.s - 1 && p.r === this.alvo.r) { this.ganhar(); return {}; }
      this.vistas.add(`${p.r},${p.c},${dr},${dc}`);
      this.perderVida();
      return { chave: "Jogo.labirinto.Bateu", classe: "erro", erro: true };
    }
    this.pos = { r: p.r + dr, c: p.c + dc };
    this.rastro.add(`${this.pos.r},${this.pos.c}`);
    if (this.pos.c === this.s - 1 && this.pos.r === this.alvo.r) return { chave: "Jogo.labirinto.Perto", classe: "ok" };
    return { chave: "Jogo.labirinto.Andando" };
  }
}

// ======================================================================
// Sigilo de traço (sigilo)
// ======================================================================

export const RECOMECAR = -1;    // jogada especial do sigilo: apaga o traço e começa de novo

class LogicaSigilo extends Logica {
  constructor(p, rng) {
    super(p, rng);
    const d = this.d;
    this.nNos = Math.min(Number(this.aj.maxRunas) || 10, 10, 5 + Math.floor(d / 2));
    const alvo = this.nNos + 1 + Math.floor(d / 2);
    // posições num círculo, com um leve desvio para não parecer régua
    this.nos = Array.from({ length: this.nNos }, (_, i) => {
      const a = (i / this.nNos) * Math.PI * 2 - Math.PI / 2;
      const r = 112 + (this.rng() * 16 - 8);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
    // o sigilo é um caminho aleatório: assim sempre dá para traçar tudo de uma vez
    let tentativa = 0;
    do {
      this.arestas = [];
      let atual = this.int(this.nNos);
      this.inicio = atual;
      for (let k = 0; k < alvo; k++) {
        const opcoes = [...this.nos.keys()].filter(j => j !== atual && this.indice(atual, j) < 0);
        if (!opcoes.length) break;
        const prox = this.sortear(opcoes);
        this.arestas.push([atual, prox]);
        atual = prox;
      }
    } while (this.arestas.length < alvo - 1 && ++tentativa < 20);
    this.usadas = new Set();
    this.atual = null;
  }

  indice(a, b) { return this.arestas.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a)); }
  grau(i) { return this.arestas.filter(([x, y]) => x === i || y === i).length; }

  /** jogada = runa tocada, ou RECOMECAR */
  aplicar(i) {
    if (i === RECOMECAR) {
      this.usadas.clear();
      this.atual = null;
      return { chave: "Jogo.sigilo.Comeco" };
    }
    if (!inteiro(i, 0, this.nNos - 1) || this.grau(i) === 0) return null;
    if (this.atual === null) {
      this.atual = i;
      return { chave: "Jogo.sigilo.Comecou" };
    }
    if (i === this.atual) return null;
    const k = this.indice(this.atual, i);
    if (k < 0 || this.usadas.has(k)) {
      this.perderVida();
      return { chave: k < 0 ? "Jogo.sigilo.SemLinha" : "Jogo.sigilo.Repetida", classe: "erro", erro: true };
    }
    this.usadas.add(k);
    this.atual = i;
    if (this.usadas.size === this.arestas.length) { this.ganhar(); return {}; }
    // sem saída: ainda faltam linhas, mas nenhuma livre parte daqui
    const livre = this.arestas.some(([a, b], j) => !this.usadas.has(j) && (a === i || b === i));
    if (!livre) {
      this.perderVida();
      if (!this.fim) { this.usadas.clear(); this.atual = null; }
      return { chave: "Jogo.sigilo.Preso", classe: "erro", erro: true };
    }
    return { chave: "Jogo.sigilo.Faltam", dados: { n: this.arestas.length - this.usadas.size } };
  }
}

// ======================================================================
// Cristais em harmonia (cristais)
// ======================================================================

class LogicaCristais extends Logica {
  constructor(p, rng) {
    super(p, rng);
    const d = this.d;
    this.g = Math.min(Number(this.aj.maxGrade) || 5, d <= 3 ? 3 : d <= 7 ? 4 : 5);
    this.luz = Array(this.g * this.g).fill(true);
    // parte do resolvido e toca alguns cristais: sempre tem solução
    do {
      for (let k = 0; k < 3 + d; k++) this.inverter(this.int(this.luz.length));
    } while (this.luz.every(Boolean));
    this.toques = 0;
  }

  resistencia() { return 0; }

  vizinhos(i) {
    const g = this.g, r = Math.floor(i / g), c = i % g;
    return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dr, dc]) => [r + dr, c + dc])
      .filter(([a, b]) => a >= 0 && b >= 0 && a < g && b < g)
      .map(([a, b]) => a * g + b);
  }

  inverter(i) {
    for (const j of this.vizinhos(i)) this.luz[j] = !this.luz[j];
  }

  /** jogada = cristal tocado */
  aplicar(i) {
    if (!inteiro(i, 0, this.luz.length - 1)) return null;
    this.inverter(i);
    this.toques += 1;
    if (this.luz.every(Boolean)) this.ganhar();
    return {};
  }
}

// ======================================================================
// Canalizar: simulação em passos fixos (DT). O registro é o número de passos e os passos em
// que o jogador apertou ou soltou o botão.
// ======================================================================

class LogicaCanalizar extends Logica {
  constructor(p, rng) {
    super(p, rng);
    const d = this.d;
    this.faixa = clamp((36 - d * 2) * (Number(this.aj.largura) || 1), 10, 60);   // altura da faixa (%)
    this.velFaixa = (8 + d * 2.5) * (Number(this.aj.velocidade) || 1);          // quanto a faixa anda (%/s)
    this.centro = 50;
    this.destino = 50;
    this.troca = 0;
    this.mana = 10;           // posição da mana (%)
    this.vel = 0;
    this.carga = 0;           // quanto o selo já encheu (%)
    this.segurando = false;
    this.ticks = 0;
    this.trocas = [];         // passos em que "segurando" mudou
  }

  resistencia() { return 0; }

  get dentro() { return Math.abs(this.mana - this.centro) <= this.faixa / 2; }

  /** Avança um passo de DT segundos. */
  passo(segurando) {
    if (this.fim) return;
    segurando = !!segurando;
    if (segurando !== this.segurando) { this.segurando = segurando; this.trocas.push(this.ticks); }
    // a faixa passeia pela coluna
    this.troca -= DT;
    if (this.troca <= 0) {
      this.destino = this.faixa / 2 + this.rng() * (100 - this.faixa);
      this.troca = 1 + this.rng() * 1.6;
    }
    const passo = this.velFaixa * DT;
    this.centro += clamp(this.destino - this.centro, -passo, passo);
    // a mana sobe enquanto segura e cai quando solta (com um pouco de embalo)
    const alvoVel = this.segurando ? 48 : -40;
    this.vel += (alvoVel - this.vel) * Math.min(1, DT * 7);
    this.mana += this.vel * DT;
    if (this.mana <= 0) { this.mana = 0; this.vel = 0; }
    if (this.mana >= 100) { this.mana = 100; this.vel = 0; }
    // dentro da faixa o selo enche; fora, esvazia
    this.carga = clamp(this.carga + (this.dentro ? 16 : -9) * DT, 0, 100);
    this.ticks += 1;
    if (this.carga >= 100) this.ganhar();
  }

  get registro() { return { ticks: this.ticks, trocas: [...this.trocas] }; }

  /** `segundos`: quanto tempo o mestre mediu desde o sorteio (o jogo não pode ter durado mais). */
  reproduzir(registro, { segundos = Infinity } = {}) {
    const ticks = registro?.ticks, trocas = registro?.trocas;
    if (!inteiro(ticks, 0, MAX_TICKS) || !Array.isArray(trocas) || trocas.length > ticks + 1) return;
    for (let k = 0; k < trocas.length; k++) {
      if (!inteiro(trocas[k], 0, ticks) || (k > 0 && trocas[k] <= trocas[k - 1])) return;
    }
    const duracao = ticks * DT;
    if (duracao > segundos + 3) return;
    if (this.p.tempo > 0 && duracao > this.p.tempo + 1) return;
    let seg = false, k = 0;
    for (let tk = 0; tk < ticks && !this.fim; tk++) {
      if (trocas[k] === tk) { seg = !seg; k++; }
      this.passo(seg);
    }
  }
}

// ======================================================================
// Fábrica e conferência
// ======================================================================

const CLASSES = {
  discos: LogicaDiscos, runas: LogicaRunas, labirinto: LogicaLabirinto,
  sigilo: LogicaSigilo, cristais: LogicaCristais, canalizar: LogicaCanalizar
};

/** Monta o jogo a partir dos parâmetros e da semente. */
export function criarLogica(tipo, p, semente) {
  const Classe = CLASSES[tipo] ?? LogicaDiscos;
  const l = new Classe(p, criarSorteio(semente));
  const n = l.resistencia();
  l.vidasMax = l.vidas = n > 0 ? Math.max(1, n + (Number(l.aj.concentracao) || 0)) : 0;
  return l;
}

/**
 * Conferência no mestre: monta o jogo com a mesma semente, refaz as jogadas recebidas e diz
 * se a fechadura abriu. Qualquer coisa estranha no registro conta como falha.
 */
export function conferir(tipo, p, semente, registro, opcoes = {}) {
  try {
    const l = criarLogica(tipo, p, semente);
    l.reproduzir(registro, opcoes);
    return l.fim === "ok";
  } catch (e) {
    console.warn("gazua-mesa | registro do minijogo inválido", e);
    return false;
  }
}
