// Robôs que resolvem cada minijogo a partir das regras (só para os testes).
// Devolvem o registro que o jogador mandaria ao mestre.

import { criarLogica } from "../scripts/logica.js";

function caminhoDiscos(l) {
  const chave = p => p.join(",");
  const anterior = new Map([[chave(l.pos), null]]);
  const fila = [[...l.pos]];
  while (fila.length) {
    const p = fila.shift();
    if (p.every(x => x === 0)) {
      const jogadas = [];
      for (let k = chave(p); anterior.get(k); k = anterior.get(k)[0]) jogadas.unshift(anterior.get(k)[1]);
      return jogadas;
    }
    for (let i = 0; i < l.n; i++) for (const d of [1, -1]) {
      const q = [...p];
      for (const j of l.ligacoes[i]) q[j] = (q[j] + d + 8) % 8;
      if (!anterior.has(chave(q))) { anterior.set(chave(q), [chave(p), [i, d]]); fila.push(q); }
    }
  }
  return [];
}

function caminhoLabirinto(l) {
  const chave = p => `${p.r},${p.c}`;
  const anterior = new Map([[chave(l.pos), null]]);
  const fila = [l.pos];
  while (fila.length) {
    const p = fila.shift();
    if (p.r === l.alvo.r && p.c === l.s - 1) {
      const jogadas = [[0, 1]];
      for (let k = chave(p); anterior.get(k); k = anterior.get(k)[0]) jogadas.unshift(anterior.get(k)[1]);
      return jogadas;
    }
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (l.parede(p, dr, dc)) continue;
      const q = { r: p.r + dr, c: p.c + dc };
      if (!anterior.has(chave(q))) { anterior.set(chave(q), [chave(p), [dr, dc]]); fila.push(q); }
    }
  }
  return [];
}

// Cristais: sistema linear em GF(2) (cada toque inverte o cristal e os vizinhos)
function toquesCristais(l) {
  const n = l.luz.length;
  const M = l.luz.map((aceso, i) => [...Array.from({ length: n }, (_, j) => (l.vizinhos(j).includes(i) ? 1 : 0)), aceso ? 0 : 1]);
  const pivos = [];
  let r = 0;
  for (let c = 0; c < n && r < n; c++) {
    const p = M.findIndex((linha, i) => i >= r && linha[c]);
    if (p < 0) continue;
    [M[r], M[p]] = [M[p], M[r]];
    for (let i = 0; i < n; i++) if (i !== r && M[i][c]) for (let k = c; k <= n; k++) M[i][k] ^= M[r][k];
    pivos.push(c);
    r++;
  }
  const x = Array(n).fill(0);
  pivos.forEach((c, i) => { x[c] = M[i][n]; });
  return x.flatMap((v, i) => (v ? [i] : []));
}

/** Joga para vencer e devolve { logica, registro }. */
export function vencer(tipo, parametros, semente) {
  const l = criarLogica(tipo, parametros, semente);
  if (tipo === "canalizar") {
    while (!l.fim && l.ticks < 60 * 120) l.passo(l.mana < l.centro);
  } else {
    const jogadas = {
      discos: () => caminhoDiscos(l),
      runas: () => [...l.esperado],
      labirinto: () => caminhoLabirinto(l),
      sigilo: () => [l.inicio, ...l.arestas.map(([, b]) => b)],
      cristais: () => toquesCristais(l)
    }[tipo]();
    for (const j of jogadas) l.jogar(j);
  }
  return { logica: l, registro: JSON.parse(JSON.stringify(l.registro)) };
}
