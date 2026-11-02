import "./fake-foundry.mjs";   // primeiro: os scripts leem o "Foundry" ao carregar
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { criarMundo } from "./fake-foundry.mjs";
import { estaTrancada, lerFechadura, JOGOS } from "../scripts/dados.js";
import { aoReceber, lerSessao } from "../scripts/mestre.js";
import { criarLogica, conferir, calcularParametros, criarSorteio, DT } from "../scripts/logica.js";
import { vencer } from "./resolver.mjs";

const ID = "gazua-mesa";
let mundo;

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_800_000_000_000 });
  mundo = criarMundo();
  mundo.criarCena();
});
afterEach(() => mock.timers.reset());

/** Pedido que chegou pelo socket, mandado de verdade por `de`. */
const pedido = (dados, de = "p1") => aoReceber({ tipo: "pedido", pedido: dados, userId: de }, de);
const esvaziar = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const resposta = (pedidoId, para = "p1") => mundo.paraUsuario(para).find(m => m.tipo === "resposta" && m.pedidoId === pedidoId);
const falhasDe = (doc, actor) => lerFechadura(doc).falhas?.[actor.id] ?? 0;

/** Cena padrão: ladina do p1 encostada numa porta trancada, com gazua. */
function cenario(fechadura = {}, { gazua = {} } = {}) {
  const actor = mundo.criarAtor();
  const item = gazua === null ? null : mundo.criarGazua(actor, gazua);
  const porta = mundo.criarPorta({ cd: 15, nivel: 3, tempo: 40, testeAntes: false, ...fechadura });
  return { actor, item, porta, base: { uuid: porta.uuid, actorUuid: actor.uuid } };
}

/* ---------- Fechadura trancada ---------- */

test("estaTrancada: porta segue o estado da porta no Foundry", () => {
  const { porta } = cenario();
  assert.equal(estaTrancada(porta), true);
  porta.ds = CONST.WALL_DOOR_STATES.CLOSED;
  assert.equal(estaTrancada(porta), false);
});

test("estaTrancada: baú e diário seguem a flag da fechadura", () => {
  const bau = mundo.criarBau();
  const diario = mundo.criarDiario();
  assert.equal(estaTrancada(bau), true);
  assert.equal(estaTrancada(diario), true);
  bau.flags[ID].fechadura.trancada = false;
  assert.equal(estaTrancada(bau), false);
  diario.flags[ID].fechadura.ativa = false;   // fechadura desligada: não tranca nada
  assert.equal(estaTrancada(diario), false);
});

/* ---------- Validação do pedido no mestre ---------- */

test("remetente errado: o mestre usa quem mandou de verdade, não o que vem no pedido", async () => {
  const { base, porta } = cenario();
  // p2 manda o pedido dizendo ser p1, com o personagem do p1
  await aoReceber({ tipo: "pedido", userId: "p1", pedido: { ...base, tipo: "arrombar", via: "teste", mensagemId: mundo.criarRolagem("p2", 30) } }, "p2");
  assert.deepEqual(mundo.chavesDeAviso("p2"), ["Aviso.NaoSeuPersonagem"]);
  assert.equal(estaTrancada(porta), true);
});

test("ator de outro jogador: recusado", async () => {
  const outro = mundo.criarAtor({ nome: "Bárbaro", dono: "p2" });
  const porta = mundo.criarPorta();
  await pedido({ tipo: "arrombar", via: "teste", uuid: porta.uuid, actorUuid: outro.uuid, mensagemId: mundo.criarRolagem("p1", 30) });
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.NaoSeuPersonagem"]);
  assert.equal(estaTrancada(porta), true);
});

test("aviso falso de um jogador é ignorado (só o mestre manda avisos)", async () => {
  await aoReceber({ tipo: "aviso", para: "mestre", chave: "Aviso.JaAberta" }, "p2");
  assert.equal(mundo.avisos.length, 0);
});

test("fora do alcance: recusado", async () => {
  const actor = mundo.criarAtor({ x: 6 });
  mundo.criarGazua(actor);
  const porta = mundo.criarPorta();
  await pedido({ tipo: "arrombar", via: "teste", uuid: porta.uuid, actorUuid: actor.uuid, mensagemId: mundo.criarRolagem("p1", 30) });
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.Longe"]);
  assert.equal(estaTrancada(porta), true);
});

test("sem tentativas: recusado", async () => {
  const { base, actor, porta } = cenario({ tentativas: 2 });
  porta.flags[ID].fechadura.falhas = { [actor.id]: 2 };
  await pedido({ ...base, tipo: "arrombar", via: "teste", mensagemId: mundo.criarRolagem("p1", 30) });
  await pedido({ ...base, tipo: "iniciarJogo", pedidoId: "x1" });
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.SemTentativas", "Aviso.SemTentativas"]);
  assert.equal(resposta("x1").dados, false);
  assert.equal(estaTrancada(porta), true);
});

test("modo só chave: arrombar e minijogo recusados", async () => {
  const { base, porta } = cenario({ modo: "chave" });
  await pedido({ ...base, tipo: "arrombar", via: "teste", mensagemId: mundo.criarRolagem("p1", 30) });
  await pedido({ ...base, tipo: "iniciarJogo", pedidoId: "x2" });
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.SoChave", "Aviso.SoChave"]);
  assert.equal(estaTrancada(porta), true);
});

test("modo só teste: o minijogo é recusado", async () => {
  const { base } = cenario({ modo: "teste" });
  await pedido({ ...base, tipo: "iniciarJogo", pedidoId: "x3" });
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.SemMinijogo"]);
  assert.equal(resposta("x3").dados, false);
});

test("sem gazua quando a fechadura exige: recusado", async () => {
  const { base } = cenario({ exigeFerramentas: true }, { gazua: null });
  await pedido({ ...base, tipo: "arrombar", via: "teste", mensagemId: mundo.criarRolagem("p1", 30) });
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Janela.SemFerramentas"]);
});

/* ---------- Teste de Ferramentas de Ladrão (rolagem no chat) ---------- */

test("teste: a rolagem do próprio jogador decide; cada rolagem vale uma vez", async () => {
  const { base, porta } = cenario();
  const msg = mundo.criarRolagem("p1", 18);
  await pedido({ ...base, tipo: "arrombar", via: "teste", mensagemId: msg });
  assert.equal(estaTrancada(porta), false);
  porta.ds = CONST.WALL_DOOR_STATES.LOCKED;
  await pedido({ ...base, tipo: "arrombar", via: "teste", mensagemId: msg });
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.SemRolagem"]);
  assert.equal(estaTrancada(porta), true);
});

test("teste: rolagem de outra pessoa não vale", async () => {
  const { base, porta } = cenario();
  await pedido({ ...base, tipo: "arrombar", via: "teste", mensagemId: mundo.criarRolagem("p2", 30) });
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.SemRolagem"]);
  assert.equal(estaTrancada(porta), true);
});

/* ---------- Desgaste da gazua ---------- */

const falharTeste = (base) => pedido({ ...base, tipo: "arrombar", via: "teste", mensagemId: mundo.criarRolagem("p1", 2) });

test("gazua que aguenta 2 falhas: entorta na primeira e quebra na segunda", async () => {
  const { base, actor, item, porta } = cenario({}, { gazua: { usosMax: 2 } });
  await falharTeste(base);
  assert.equal(item.flags[ID].gazua.usados, 1);
  assert.ok(actor.items.has(item.id));
  assert.equal(falhasDe(porta, actor), 1);
  await falharTeste(base);
  assert.ok(!actor.items.has(item.id), "a gazua saiu do inventário");
  assert.equal(falhasDe(porta, actor), 2);
});

test("gazua com quantidade: cada quebra tira uma", async () => {
  const { base, item } = cenario({}, { gazua: { quantidade: 3 } });
  await falharTeste(base);
  assert.equal(item.system.quantity, 2);
});

test("gazua com usos na ficha: cada quebra gasta um uso", async () => {
  const { base, item } = cenario({}, { gazua: { usos: 20 } });
  await falharTeste(base);
  assert.equal(item.system.uses.spent, 1);
});

test("opção 'quebra só nos minijogos': o teste não desgasta", async () => {
  mundo = criarMundo({ ajustes: { quebraGazua: "minijogos" } });
  mundo.criarCena();
  const { base, item } = cenario();
  await falharTeste(base);
  assert.equal(item.system.quantity, 1);
  assert.equal(item.flags[ID].gazua.usados, 0);
});

/* ---------- Minijogo: sorteio e veredito no mestre ---------- */

/** Pede o minijogo como o jogador e devolve a sessão que o mestre mandou. */
async function iniciar(base, extra = {}, id = foundry.utils.randomID()) {
  await pedido({ ...base, tipo: "iniciarJogo", pedidoId: id, ...extra });
  return resposta(id)?.dados;
}

test("minijogo: o mestre sorteia, guarda a sessão na fechadura e aceita uma vitória de verdade", async () => {
  const { base, actor, porta } = cenario({ minijogo: "labirinto" });
  const s = await iniciar(base);
  assert.equal(s.tipo, "labirinto");
  assert.ok(Number.isInteger(s.semente));
  assert.equal(lerSessao(porta, "p1").semente, s.semente);
  assert.equal(lerSessao(porta, "p1").actorUuid, actor.uuid);
  const { registro } = vencer(s.tipo, s.parametros, s.semente);
  await pedido({ ...base, tipo: "arrombar", via: "minigame", registro });
  assert.equal(estaTrancada(porta), false);
  assert.equal(lerSessao(porta, "p1"), null, "a sessão acabou");
});

test("minijogo: o jogador dizer 'abri' não basta (registro sem vitória conta como falha)", async () => {
  const { base, actor, porta } = cenario({ minijogo: "cristais" });
  await iniciar(base);
  await pedido({ ...base, tipo: "arrombar", via: "minigame", sucesso: true, registro: [] });
  assert.equal(estaTrancada(porta), true);
  assert.equal(falhasDe(porta, actor), 1);
  assert.equal(lerSessao(porta, "p1"), null);
});

test("minijogo: jogadas de outra semente não abrem", async () => {
  const { base, porta } = cenario({ minijogo: "runas" });
  const s = await iniciar(base);
  const { registro } = vencer(s.tipo, s.parametros, s.semente + 1);
  const outraServe = conferir(s.tipo, s.parametros, s.semente, registro);
  await pedido({ ...base, tipo: "arrombar", via: "minigame", registro });
  assert.equal(estaTrancada(porta), !outraServe);
});

test("minijogo: resultado sem sessão é recusado", async () => {
  const { base, actor, porta } = cenario();
  await pedido({ ...base, tipo: "arrombar", via: "minigame", registro: [] });
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.SemJogo"]);
  assert.equal(falhasDe(porta, actor), 0);
});

test("minijogo: pedir de novo com a sessão aberta devolve o mesmo jogo (sem sortear outro)", async () => {
  const { base } = cenario();
  const a = await iniciar(base);
  mock.timers.tick(10000);
  const b = await iniciar(base);
  assert.equal(b.semente, a.semente);
  assert.equal(b.tipo, a.tipo);
  assert.equal(b.decorrido, 10);
});

test("minijogo: largado aberto, expira em 5 minutos e conta como falha", async () => {
  const { base, actor, porta } = cenario({ tempo: 0 });
  await iniciar(base);
  mock.timers.tick(5 * 60000 + 2000);
  await esvaziar();
  assert.equal(lerSessao(porta, "p1"), null);
  assert.equal(falhasDe(porta, actor), 1);
  assert.ok(mundo.chavesDeAviso("p1").includes("Aviso.JogoExpirou"));
});

test("minijogo: vitória que chega depois do tempo limite não vale", async () => {
  const { base, porta } = cenario({ minijogo: "discos", tempo: 40 });
  const s = await iniciar(base);
  const { registro } = vencer(s.tipo, s.parametros, s.semente);
  mock.timers.tick((s.parametros.tempo + 30) * 1000);
  await pedido({ ...base, tipo: "arrombar", via: "minigame", registro });
  assert.equal(estaTrancada(porta), true);
});

test("minijogo com teste antes: sem rolagem não começa", async () => {
  const { base, porta } = cenario({ testeAntes: true });
  const s = await iniciar(base);
  assert.equal(s, false);
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.SemRolagem"]);
  assert.equal(lerSessao(porta, "p1"), null);
});

test("minijogo com teste antes: falhar na CD conta a falha e não começa", async () => {
  const { base, actor, porta } = cenario({ testeAntes: true });
  const s = await iniciar(base, { mensagemId: mundo.criarRolagem("p1", 5) });
  assert.equal(s, false);
  assert.equal(falhasDe(porta, actor), 1);
});

test("minijogo com teste antes: o tempo extra sai da margem lida pelo mestre", async () => {
  const { base } = cenario({ testeAntes: true, cd: 15, tempo: 40 }, { gazua: { bonus: 1 } });
  const s = await iniciar(base, { mensagemId: mundo.criarRolagem("p1", 19) });   // 19 + 1 = 20: margem 5
  assert.equal(s.parametros.extra, 2 * 5 + 2 * 1);
  assert.equal(s.parametros.tempo, 40 + 12);
});

for (const tipo of JOGOS) {
  test(`minijogo ${tipo}: o mestre aceita a vitória feita a partir da semente dele`, async () => {
    const { base, porta } = cenario({ minijogo: tipo, nivel: 7, tempo: 0 });
    const s = await iniciar(base);
    assert.equal(s.tipo, tipo);
    const { registro, logica } = vencer(s.tipo, s.parametros, s.semente);
    assert.equal(logica.fim, "ok");
    // o jogador leva o tempo da partida (no Canalizar o mestre confere isso pelo relógio dele)
    mock.timers.tick(Math.ceil((logica.ticks ?? 0) * DT * 1000) + 1000);
    await pedido({ ...base, tipo: "arrombar", via: "minigame", registro });
    assert.equal(estaTrancada(porta), false);
  });
}

/* ---------- Sorteio determinístico ---------- */

const PARAMS = d => calcularParametros({ nivel: d, cd: 10, tempo: 40 }, { total: 0, mult: 0 }, {}, {});
// o Canalizar só usa o sorteio quando a faixa começa a andar: compara depois de 3 s de jogo
const montar = (tipo, p, semente) => {
  const l = criarLogica(tipo, p, semente);
  if (tipo === "canalizar") for (let k = 0; k < 180; k++) l.passo(k % 50 < 25);
  return l;
};
const estado = l => JSON.stringify(Object.entries(l).filter(([k]) => k !== "rng"), (k, v) => (v instanceof Set ? [...v] : v));

test("gerador: a mesma semente dá a mesma sequência", () => {
  const a = criarSorteio(123), b = criarSorteio(123), c = criarSorteio(124);
  const sa = Array.from({ length: 50 }, a), sb = Array.from({ length: 50 }, b), sc = Array.from({ length: 50 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every(x => x >= 0 && x < 1));
});

test("cada jogo: a mesma semente monta o mesmo desafio; sementes diferentes, desafios diferentes", () => {
  for (const tipo of JOGOS) {
    for (let d = 1; d <= 10; d++) {
      assert.equal(estado(montar(tipo, PARAMS(d), 777)), estado(montar(tipo, PARAMS(d), 777)), `${tipo} d${d}`);
    }
    const varios = new Set(Array.from({ length: 10 }, (_, s) => estado(montar(tipo, PARAMS(5), s + 1))));
    assert.ok(varios.size > 1, `${tipo}: todas as sementes deram o mesmo jogo`);
  }
});

test("cada jogo, toda dificuldade: vitória aceita; registro vazio ou lixo recusado", () => {
  for (const tipo of JOGOS) for (let d = 1; d <= 10; d++) for (let s = 1; s <= 5; s++) {
    const p = PARAMS(d);
    const { registro, logica } = vencer(tipo, p, s * 7919 + d);
    assert.equal(logica.fim, "ok", `${tipo} d${d} s${s}: o robô não venceu`);
    assert.equal(conferir(tipo, p, s * 7919 + d, registro), true, `${tipo} d${d}: vitória recusada`);
    const vazio = tipo === "canalizar" ? { ticks: 0, trocas: [] } : [];
    assert.equal(conferir(tipo, p, s * 7919 + d, vazio), false, `${tipo} d${d}: registro vazio aceito`);
    assert.equal(conferir(tipo, p, s * 7919 + d, "lixo"), false);
    assert.equal(conferir(tipo, p, s * 7919 + d, { ticks: 1e9, trocas: [] }), false);
  }
});

test("canalizar: partida mais longa do que o tempo medido pelo mestre não vale", () => {
  const p = calcularParametros({ nivel: 3, cd: 10, tempo: 0 }, { total: 0, mult: 0 }, {}, {});
  const { registro } = vencer("canalizar", p, 5);
  assert.equal(conferir("canalizar", p, 5, registro, { segundos: 60 }), true);
  assert.equal(conferir("canalizar", p, 5, registro, { segundos: 1 }), false);
});

test("erros desgastam a concentração até quebrar", () => {
  const l = criarLogica("runas", PARAMS(5), 9);
  const errada = (l.esperado[0] + 1) % l.qtd;
  for (let k = 0; k < l.vidasMax; k++) l.jogar(errada);
  assert.equal(l.fim, "falha");
  assert.equal(l.motivo, "Jogo.Quebrou");
});

test("labirinto: a resistência acompanha o tamanho (passada na criação)", () => {
  const p = { ...PARAMS(10), expertise: true, aj: { concentracao: 1 } };
  const l = criarLogica("labirinto", p, 3);
  assert.equal(l.vidasMax, Math.round(l.s * 1.2) + 2 + 1);
});

/* ---------- v1.6.1: concorrência, estoque e modalidade ---------- */

test("pedidos simultâneos: dois pedidos de chave abrem uma vez e gastam uma chave", async () => {
  const { actor, porta } = cenario({ segredos: "ferro" });
  const chave = mundo.criarItem(actor, { name: "Chave", type: "loot", system: { quantity: 3 }, flags: { [ID]: { chave: { ativa: true, segredos: "ferro" } } } });
  const p = { tipo: "chave", uuid: porta.uuid, actorUuid: actor.uuid, itemUuid: chave.uuid };
  await Promise.all([pedido(p), pedido(p)]);
  assert.equal(chave.system.quantity, 2);
  assert.equal(Hooks.chamados.filter(h => h === "gazua-mesa.destrancou").length, 1);
});

test("pedidos simultâneos: com uma tentativa, duas falhas juntas contam uma e quebram uma gazua", async () => {
  const { base, actor, item, porta } = cenario({ tentativas: 1 }, { gazua: { quantidade: 3 } });
  await Promise.all([falharTeste(base), falharTeste(base)]);
  assert.equal(falhasDe(porta, actor), 1);
  assert.equal(item.system.quantity, 2);
  assert.ok(mundo.chavesDeAviso("p1").includes("Aviso.SemTentativas"));
});

test("Dados em Cena: esperar a rolagem não trava os outros pedidos", async () => {
  let rolar;
  mundo = criarMundo({ ajustes: { testeDadosEmCena: "animada" } });
  game.modules.set("dados-em-cena", { active: true, api: { pedirTeste: () => new Promise(r => { rolar = r; }) } });
  mundo.criarCena();
  const { base, porta } = cenario({ modo: "ambos" });
  const outra = mundo.criarPorta({ segredos: "x" }, { x: 0, y: 1 });
  const ator2 = mundo.criarAtor({ nome: "Guerreiro", dono: "p2", x: 0, y: 2 });
  const chave = mundo.criarItem(ator2, { name: "Chave", type: "loot", flags: { [ID]: { chave: { ativa: true, segredos: "x" } } } });
  const teste = pedido({ ...base, tipo: "testeDC", pedidoId: "dc1", finalidade: "teste" });
  await esvaziar();
  await pedido({ tipo: "chave", uuid: outra.uuid, actorUuid: ator2.uuid, itemUuid: chave.uuid }, "p2");
  assert.equal(estaTrancada(outra), false, "a chave do outro jogador abriu enquanto o teste esperava");
  rolar({ total: 20 });
  await teste; await esvaziar();
  assert.equal(estaTrancada(porta), false);
});

test("Dados em Cena: a fechadura aberta enquanto o jogador rolava não abre de novo", async () => {
  let rolar;
  mundo = criarMundo({ ajustes: { testeDadosEmCena: "animada" } });
  game.modules.set("dados-em-cena", { active: true, api: { pedirTeste: () => new Promise(r => { rolar = r; }) } });
  mundo.criarCena();
  const { base, porta } = cenario({ modo: "ambos" });
  pedido({ ...base, tipo: "testeDC", pedidoId: "dc2", finalidade: "teste" });
  await esvaziar();
  porta.ds = CONST.WALL_DOOR_STATES.OPEN;
  rolar({ total: 20 });
  await esvaziar();
  assert.equal(Hooks.chamados.filter(h => h === "gazua-mesa.destrancou").length, 0);
});

test("minijogo de outra abertura: destrancar encerra as sessões; trancar de novo não traz falha antiga", async () => {
  const { base, actor, item, porta } = cenario({ segredos: "ferro", tempo: 0 }, { gazua: { quantidade: 2 } });
  await iniciar(base);
  const b = mundo.criarAtor({ nome: "Bardo", dono: "p2" });
  const chave = mundo.criarItem(b, { name: "Chave", type: "loot", flags: { [ID]: { chave: { ativa: true, segredos: "ferro" } } } });
  await pedido({ tipo: "chave", uuid: porta.uuid, actorUuid: b.uuid, itemUuid: chave.uuid }, "p2");
  assert.equal(lerSessao(porta, "p1"), null, "a sessão de A acabou com a abertura");
  porta.ds = CONST.WALL_DOOR_STATES.LOCKED;   // o mestre tranca de novo
  mock.timers.tick(5 * 60000 + 2000);
  await esvaziar();
  assert.equal(falhasDe(porta, actor), 0);
  assert.equal(item.system.quantity, 2);
  // e o resultado atrasado de A também não vale
  await pedido({ ...base, tipo: "arrombar", via: "minigame", registro: [] });
  assert.deepEqual(mundo.chavesDeAviso("p1").at(-1), "Aviso.SemJogo");
  assert.equal(falhasDe(porta, actor), 0);
});

test("chave mestra empilhada: cada unidade tem os próprios usos (2 x 2 usos = 4 aberturas)", async () => {
  const { actor, porta } = cenario();
  const mestra = mundo.criarItem(actor, { name: "Mestra", type: "loot", system: { quantity: 2 }, flags: { [ID]: { chave: { ativa: true, mestra: true, usosMax: 2, usados: 0 } } } });
  let aberturas = 0;
  for (let k = 0; k < 6; k++) {
    porta.ds = CONST.WALL_DOOR_STATES.LOCKED;
    await pedido({ tipo: "chave", uuid: porta.uuid, actorUuid: actor.uuid, itemUuid: mestra.uuid });
    if (!estaTrancada(porta)) aberturas++;
  }
  assert.equal(aberturas, 4);
  assert.ok(!actor.items.has(mestra.id));
});

test("gazua com quantidade zero não serve", async () => {
  const { base, actor, porta } = cenario({ exigeFerramentas: true }, { gazua: { quantidade: 0 } });
  const { gazuaDoAtor } = await import("../scripts/dados.js");
  assert.equal(gazuaDoAtor(actor), null);
  await pedido({ ...base, tipo: "arrombar", via: "teste", mensagemId: mundo.criarRolagem("p1", 30) });
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Janela.SemFerramentas"]);
  assert.equal(estaTrancada(porta), true);
});

test("chave com quantidade zero não abre", async () => {
  const { actor, porta } = cenario({ segredos: "ferro" });
  const chave = mundo.criarItem(actor, { name: "Chave", type: "loot", system: { quantity: 0 }, flags: { [ID]: { chave: { ativa: true, segredos: "ferro" } } } });
  await pedido({ tipo: "chave", uuid: porta.uuid, actorUuid: actor.uuid, itemUuid: chave.uuid });
  assert.equal(estaTrancada(porta), true);
});

test("fechadura só de minijogo: teste simples bem-sucedido não destranca", async () => {
  const { base, porta } = cenario({ modo: "minigame", testeAntes: true });
  await pedido({ ...base, tipo: "arrombar", via: "teste", mensagemId: mundo.criarRolagem("p1", 30) });
  assert.equal(estaTrancada(porta), true);
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.SemTeste"]);
});

test("fechadura só de minijogo: a falha no teste antes ainda conta", async () => {
  const { base, actor, porta } = cenario({ modo: "minigame", testeAntes: true });
  await falharTeste(base);
  assert.equal(falhasDe(porta, actor), 1);
});

test("fechadura só de minijogo, sem teste antes: nenhum teste vale", async () => {
  const { base, actor, porta } = cenario({ modo: "minigame", testeAntes: false });
  await falharTeste(base);
  assert.equal(falhasDe(porta, actor), 0);
  assert.deepEqual(mundo.chavesDeAviso("p1"), ["Aviso.SemTeste"]);
});

test("Dados em Cena: teste 'para abrir' recusado numa fechadura só de minijogo", async () => {
  mundo = criarMundo({ ajustes: { testeDadosEmCena: "animada" } });
  game.modules.set("dados-em-cena", { active: true, api: { pedirTeste: async () => ({ total: 30 }) } });
  mundo.criarCena();
  const { base, porta } = cenario({ modo: "minigame", testeAntes: true });
  await pedido({ ...base, tipo: "testeDC", pedidoId: "dc3", finalidade: "teste" });
  await esvaziar();
  assert.equal(estaTrancada(porta), true);
  assert.equal(resposta("dc3").dados, false);
});
