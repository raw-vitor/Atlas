/**
 * Durable Object `Conversa`: trava, fila at-least-once, cancelamento, expiração, caso durável, SSE com reconexão e purga.
 * Roda dentro do workerd local (npm run test:workers). Para "envelhecer" uma tarefa, o teste altera `tarefa.atualizada` no SQL do
 * próprio DO em vez de usar relógio falso.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHUNK_CASO, LEASE_MS, MAX_EVENTOS } from "../../lib/tarefas/limites";
import { criarServidor, novoId } from "./helper";

const t = criarServidor();

type Tarefa = { id: string; tipo: string; status: string; iniciada: number };
type Iniciar = { ok: boolean; ocupado?: boolean; purgada?: boolean; tarefa: Tarefa };
type Salvar = { ok: boolean; motivo?: string; versao: number };

const iniciar = (id: string, tipo = "turno", payload?: unknown) => t.rpc<Iniciar>(id, "iniciarTarefa", tipo, payload);
const caso = async (id: string) => (await t.rpc<{ caso: unknown; versao: number }>(id, "obterCaso")).caso;
const envelhecer = async (id: string, ms: number) => {
  const exec = await t.sql(id);
  await exec("UPDATE tarefa SET atualizada = atualizada - ? WHERE status IN ('na_fila','rodando')", ms);
};

beforeAll(async () => { await t.server.listen(); });
afterAll(async () => { await t.server.close(); });

describe("trava da conversa (iniciarTarefa)", () => {
  it("vinte pedidos simultâneos: um ok e dezenove ocupados, todos apontando para a mesma tarefa", async () => {
    const id = novoId();
    const r = await Promise.all(Array.from({ length: 20 }, () => iniciar(id)));
    const ok = r.filter((x) => x.ok);
    expect(ok).toHaveLength(1);
    const ocupados = r.filter((x) => x.ocupado);
    expect(ocupados).toHaveLength(19);
    for (const o of ocupados) expect(o.tarefa.id).toBe(ok[0].tarefa.id);
    expect(ok[0].tarefa.status).toBe("na_fila");
  });

  it("conversas diferentes não se travam entre si", async () => {
    const [a, b] = [novoId(), novoId()];
    const [ra, rb] = await Promise.all([iniciar(a), iniciar(b)]);
    expect(ra.ok && rb.ok).toBe(true);
  });

  it("libera a trava ao terminar e aceita nova tarefa; terminar duas vezes é idempotente", async () => {
    const id = novoId();
    const { tarefa } = await iniciar(id);
    const f1 = await t.rpc<{ ok: boolean; jaEncerrada: boolean }>(id, "terminarTarefa", "concluida", { tarefaId: tarefa.id });
    expect(f1).toMatchObject({ ok: true, jaEncerrada: false });
    const f2 = await t.rpc<{ ok: boolean; jaEncerrada: boolean }>(id, "terminarTarefa", "erro", { tarefaId: tarefa.id });
    expect(f2).toMatchObject({ ok: true, jaEncerrada: true });
    expect((await t.rpc<{ tarefa: Tarefa }>(id, "estado")).tarefa.status).toBe("concluida"); // o segundo não sobrescreve
    expect((await iniciar(id)).ok).toBe(true);
  });

  it("tarefa abandonada (sem batimento além do lease) destrava a conversa e devolve o caso ao instantâneo", async () => {
    const id = novoId();
    await t.rpc(id, "salvarCaso", { v: 1 });
    const a = await iniciar(id);
    await t.rpc(id, "comecarTarefa", a.tarefa.id, 1);
    expect(await t.rpc(id, "salvarCaso", { v: 2, parcial: true }, { tarefaId: a.tarefa.id })).toMatchObject({ ok: true });
    expect((await iniciar(id)).ocupado).toBe(true); // ainda dentro do lease
    await envelhecer(id, LEASE_MS + 1000);
    const b = await iniciar(id);
    expect(b.ok).toBe(true);
    expect(b.tarefa.id).not.toBe(a.tarefa.id);
    expect(await caso(id)).toEqual({ v: 1 }); // o resultado parcial da tarefa morta foi descartado
    expect((await t.rpc<{ tarefa: Tarefa }>(id, "estado")).tarefa.id).toBe(b.tarefa.id);
    // O consumidor atrasado da tarefa antiga não consegue mais gravar nada.
    expect(await t.rpc(id, "salvarCaso", { v: 99 }, { tarefaId: a.tarefa.id })).toMatchObject({ ok: false, motivo: "tarefa" });
    expect(await t.rpc(id, "publicar", "atividade", { texto: "atrasado" }, a.tarefa.id)).toBeNull();
    expect(await t.rpc(id, "batimento", a.tarefa.id)).toEqual({ ativa: false, cancelada: false });
    expect(await caso(id)).toEqual({ v: 1 });
  });
});

describe("entrega at-least-once da fila (comecarTarefa)", () => {
  it("devolve o payload guardado no DO; duplicata da mesma tentativa é recusada; reentrega com tentativa maior continua", async () => {
    const id = novoId();
    const { tarefa } = await iniciar(id, "turno", { texto: "olá", anexos: ["k1"] });
    const c1 = await t.rpc<{ ok: boolean; payload: unknown; tarefa: Tarefa }>(id, "comecarTarefa", tarefa.id, 1);
    expect(c1).toMatchObject({ ok: true, payload: { texto: "olá", anexos: ["k1"] } });
    expect(c1.tarefa.status).toBe("rodando");
    expect(await t.rpc(id, "comecarTarefa", tarefa.id, 1)).toMatchObject({ ok: false, motivo: "em_execucao" });
    expect(await t.rpc(id, "comecarTarefa", tarefa.id, 2)).toMatchObject({ ok: true });
    expect(await t.rpc(id, "comecarTarefa", "nao-existe", 1)).toMatchObject({ ok: false, motivo: "inexistente" });
  });

  it("entrega depois de a tarefa encerrar (cancelada na fila, concluída) só dá ack", async () => {
    const id = novoId();
    const { tarefa } = await iniciar(id);
    await t.rpc(id, "cancelar");
    expect(await t.rpc(id, "comecarTarefa", tarefa.id, 1)).toMatchObject({ ok: false, motivo: "encerrada" });
    const outra = (await iniciar(id)).tarefa;
    await t.rpc(id, "comecarTarefa", outra.id, 1);
    await t.rpc(id, "terminarTarefa", "concluida", { tarefaId: outra.id });
    expect(await t.rpc(id, "comecarTarefa", outra.id, 2)).toMatchObject({ ok: false, motivo: "encerrada" });
  });
});

describe("cancelamento", () => {
  it("na fila: encerra na hora, restaura o caso e publica fim; é idempotente", async () => {
    const id = novoId();
    await t.rpc(id, "salvarCaso", { v: 1 });
    const { tarefa } = await iniciar(id);
    await t.rpc(id, "salvarCaso", { v: 2 }, { tarefaId: tarefa.id });
    const c = await t.rpc<{ cancelada: boolean; tarefa: Tarefa }>(id, "cancelar");
    expect(c).toMatchObject({ cancelada: true, tarefa: { status: "cancelada" } });
    expect(await caso(id)).toEqual({ v: 1 });
    const evs = await t.rpc<{ evento: string; dados: unknown }[]>(id, "eventosDesde", 0);
    expect(evs.at(-1)).toMatchObject({ evento: "fim", dados: { status: "cancelada" } });
    expect(await t.rpc(id, "cancelar")).toMatchObject({ ok: true, cancelada: false, cancelando: false, tarefa: null });
    expect((await t.rpc<{ tarefa: Tarefa }>(id, "estado")).tarefa.status).toBe("cancelada");
  });

  it("rodando: grava a marca, o consumidor a vê no batimento e encerra restaurando o caso", async () => {
    const id = novoId();
    await t.rpc(id, "salvarCaso", { v: 1 });
    const { tarefa } = await iniciar(id);
    await t.rpc(id, "comecarTarefa", tarefa.id, 1);
    await t.rpc(id, "salvarCaso", { v: 2 }, { tarefaId: tarefa.id });
    expect(await t.rpc(id, "batimento", tarefa.id)).toEqual({ ativa: true, cancelada: false });
    expect(await t.rpc(id, "cancelado")).toBe(false);
    expect(await t.rpc(id, "cancelar")).toMatchObject({ cancelada: false, cancelando: true });
    expect(await t.rpc(id, "cancelar")).toMatchObject({ cancelando: true }); // idempotente
    expect(await t.rpc(id, "cancelado")).toBe(true);
    expect(await t.rpc(id, "batimento", tarefa.id)).toEqual({ ativa: true, cancelada: true });
    expect((await iniciar(id)).ocupado).toBe(true); // só libera quando o consumidor encerra
    await t.rpc(id, "terminarTarefa", "cancelada", { tarefaId: tarefa.id });
    expect(await caso(id)).toEqual({ v: 1 });
    expect(await t.rpc(id, "batimento", tarefa.id)).toEqual({ ativa: false, cancelada: true });
    expect((await iniciar(id)).ok).toBe(true);
  });

  it("o medidor volta ao valor de antes da tarefa cancelada (e a uma conversa sem medição, a nenhuma)", async () => {
    const ctx = (tokens: number, estimado: boolean) => ({ tokens, limite: 1000, pct: tokens / 10, estimado, partes: {} });
    const estado = async (id: string) => (await t.rpc<{ contexto: unknown }>(id, "estado")).contexto;
    const id = novoId();
    await t.rpc(id, "publicar", "contexto", ctx(100, false));
    const a = await iniciar(id);
    await t.rpc(id, "comecarTarefa", a.tarefa.id, 1);
    await t.rpc(id, "publicar", "contexto", ctx(700, true), a.tarefa.id); // estimativa do começo do turno
    expect(await estado(id)).toMatchObject({ tokens: 700, estimado: true });
    await t.rpc(id, "terminarTarefa", "cancelada", { tarefaId: a.tarefa.id });
    expect(await estado(id)).toMatchObject({ tokens: 100, estimado: false });

    const vazia = novoId();
    const b = await iniciar(vazia);
    await t.rpc(vazia, "publicar", "contexto", ctx(50, true), b.tarefa.id);
    await t.rpc(vazia, "cancelar");
    expect(await estado(vazia)).toBeNull();

    // concluída mantém o valor novo
    const c = await iniciar(id);
    await t.rpc(id, "publicar", "contexto", ctx(300, false), c.tarefa.id);
    await t.rpc(id, "terminarTarefa", "concluida", { tarefaId: c.tarefa.id });
    expect(await estado(id)).toMatchObject({ tokens: 300 });
  });

  it("cancelar logo depois de a tarefa começar e a retentativa da fila não revivem uma tarefa cancelada", async () => {
    const id = novoId();
    const { tarefa } = await iniciar(id);
    await t.rpc(id, "comecarTarefa", tarefa.id, 1);
    await t.rpc(id, "cancelar");
    // O consumidor morreu antes de ver a marca; a fila reentrega.
    expect(await t.rpc(id, "comecarTarefa", tarefa.id, 2)).toMatchObject({ ok: false, motivo: "encerrada" });
    expect((await t.rpc<{ tarefa: Tarefa }>(id, "estado")).tarefa.status).toBe("cancelada");
  });

  it("sem tarefa ativa, cancelar não faz nada", async () => {
    expect(await t.rpc(novoId(), "cancelar")).toMatchObject({ ok: true, cancelada: false, cancelando: false, tarefa: null });
  });
});

describe("caso durável", () => {
  it("controle otimista de versão", async () => {
    const id = novoId();
    expect(await t.rpc<Salvar>(id, "salvarCaso", { n: 1 }, { versao: 0 })).toEqual({ ok: true, versao: 1 });
    expect(await t.rpc<Salvar>(id, "salvarCaso", { n: 2 }, { versao: 0 })).toEqual({ ok: false, motivo: "versao", versao: 1 });
    expect(await caso(id)).toEqual({ n: 1 });
  });

  it("caso maior que uma linha do SQLite do DO é gravado em pedaços e volta idêntico, sem partir emoji no limite", async () => {
    const id = novoId();
    // Emoji (par substituto) exatamente na fronteira do primeiro pedaço: o JSON começa com `{"t":"` (6 caracteres).
    const antes = "a".repeat(CHUNK_CASO - 6 - 1);
    const grande = { t: `${antes}😀${"b".repeat(CHUNK_CASO * 2)}ção😀` };
    expect(JSON.stringify(grande).charCodeAt(CHUNK_CASO - 1)).toBeGreaterThanOrEqual(0xd800); // a fronteira cai dentro do par
    expect(await t.rpc<Salvar>(id, "salvarCaso", grande)).toMatchObject({ ok: true });
    const exec = await t.sql(id);
    expect((await exec("SELECT COUNT(*) AS n FROM caso WHERE slot = 'atual'"))[0]).toEqual({ n: 4 });
    expect(await caso(id)).toEqual(grande);
    await t.evictar(id);
    expect(await caso(id)).toEqual(grande);
  });

  it("estado e alertas sobrevivem a despejar o DO da memória", async () => {
    const id = novoId();
    await t.rpc(id, "salvarCaso", { v: 1 });
    const { tarefa } = await iniciar(id, "turno", { x: 1 });
    await t.rpc(id, "publicar", "contexto", { tokens: 10, limite: 100, pct: 10 }, tarefa.id);
    await t.rpc(id, "alertaVisto", 60);
    await t.evictar(id);
    const est = await t.rpc<{ tarefa: Tarefa; contexto: unknown; alertasVistos: number[] }>(id, "estado");
    expect(est.tarefa.id).toBe(tarefa.id);
    expect(est.contexto).toEqual({ tokens: 10, limite: 100, pct: 10 });
    expect(est.alertasVistos).toEqual([60]);
    expect((await iniciar(id)).ocupado).toBe(true); // a trava também é durável
    expect(await t.rpc(id, "comecarTarefa", tarefa.id, 1)).toMatchObject({ ok: true, payload: { x: 1 } });
  });
});

describe("alertas do medidor", () => {
  it("grava a faixa uma vez, recusa faixa inválida", async () => {
    const id = novoId();
    expect(await t.rpc(id, "alertaVisto", 85)).toEqual([85]);
    expect(await t.rpc(id, "alertaVisto", 85)).toEqual([85]);
    expect(await t.rpc(id, "alertaVisto", 60)).toEqual([60, 85]);
    expect(await t.rpc(id, "alertaVisto", 70)).toBeNull();
    expect((await t.rpc<{ alertasVistos: number[] }>(id, "estado")).alertasVistos).toEqual([60, 85]);
  });
});

describe("eventos e retenção", () => {
  it("ids crescentes por conversa; mantém a tarefa atual e a última encerrada, descarta as mais antigas", async () => {
    const id = novoId();
    const t1 = (await iniciar(id)).tarefa;
    const e1 = await t.rpc<number>(id, "publicar", "atividade", { texto: "t1" }, t1.id);
    await t.rpc(id, "terminarTarefa", "concluida", { tarefaId: t1.id });
    const t2 = (await iniciar(id)).tarefa;
    const e2 = await t.rpc<number>(id, "publicar", "atividade", { texto: "t2" }, t2.id);
    expect(e2).toBeGreaterThan(e1);
    expect((await t.rpc<unknown[]>(id, "eventosDesde", 0)).map((e) => (e as { dados: { texto?: string } }).dados.texto).filter(Boolean)).toEqual(["t1", "t2"]);
    await t.rpc(id, "terminarTarefa", "concluida", { tarefaId: t2.id });
    const t3 = (await iniciar(id)).tarefa;
    const e3 = await t.rpc<number>(id, "publicar", "atividade", { texto: "t3" }, t3.id);
    expect(e3).toBeGreaterThan(e2);
    const textos = (await t.rpc<{ dados: { texto?: string } }[]>(id, "eventosDesde", 0)).map((e) => e.dados.texto).filter(Boolean);
    expect(textos).toEqual(["t2", "t3"]); // t1 saiu
    const tarefas = await (await t.sql(id))("SELECT COUNT(*) AS n FROM tarefa");
    expect(tarefas[0]).toEqual({ n: 2 });
  });

  it("limita os eventos guardados", async () => {
    const id = novoId();
    const { tarefa } = await iniciar(id);
    const exec = await t.sql(id);
    // Semeia mais eventos que o limite direto no SQL do DO (publicar milhares de vezes por RPC seria lento) e publica um.
    await exec(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO eventos (tarefa_id, evento, dados, criado) SELECT ?, 'texto', '{}', 0 FROM n`,
      MAX_EVENTOS + 25, tarefa.id,
    );
    const ultimo = await t.rpc<number>(id, "publicar", "texto", { i: "novo" }, tarefa.id);
    expect(((await exec("SELECT COUNT(*) AS n FROM eventos"))[0] as { n: number }).n).toBe(MAX_EVENTOS);
    expect(((await exec("SELECT MAX(id) AS m FROM eventos"))[0] as { m: number }).m).toBe(ultimo);
  });

  it("evento publicado numa tarefa que já terminou é ignorado", async () => {
    const id = novoId();
    const { tarefa } = await iniciar(id);
    await t.rpc(id, "terminarTarefa", "concluida", { tarefaId: tarefa.id });
    expect(await t.rpc(id, "publicar", "texto", { texto: "tarde" }, tarefa.id)).toBeNull();
  });
});

describe("SSE com reconexão", () => {
  it("o primeiro evento é estado; sem tarefa fica aberto e entrega o que for publicado", async () => {
    const id = novoId();
    const sse = await t.abrirSse(id);
    await sse.esperar(1);
    expect(sse.quadros.find((q) => q.evento)).toMatchObject({ evento: "estado", dados: { tarefa: null } });
    expect(sse.quadros.find((q) => q.evento)!.id).toBeUndefined(); // estado não tem id: não mexe no Last-Event-ID
    const { tarefa } = await iniciar(id);
    await sse.esperar(2);
    expect(sse.quadros.filter((q) => q.evento)[1]).toMatchObject({ evento: "estado", dados: { tarefa: { id: tarefa.id, status: "na_fila" } } });
    await t.rpc(id, "publicar", "atividade", { texto: "lendo" }, tarefa.id);
    await t.rpc(id, "terminarTarefa", "concluida", { tarefaId: tarefa.id });
    await sse.esperar(4);
    expect(sse.eventos()).toEqual(["estado", "estado", "atividade", "fim"]);
    const ids = sse.quadros.filter((q) => q.id !== undefined).map((q) => q.id!);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    await sse.fechar();
  });

  it("recarregar a página no meio da tarefa (sem Last-Event-ID) reenvia o progresso da tarefa ativa, sem perder nem duplicar", async () => {
    const id = novoId();
    const { tarefa } = await iniciar(id);
    await t.rpc(id, "publicar", "atividade", { texto: "um" }, tarefa.id);
    await t.rpc(id, "publicar", "atividade", { texto: "dois" }, tarefa.id);
    const sse = await t.abrirSse(id);
    await sse.esperar(3);
    await t.rpc(id, "publicar", "atividade", { texto: "tres" }, tarefa.id);
    await sse.esperar(4);
    const textos = sse.quadros.filter((q) => q.evento === "atividade").map((q) => (q.dados as { texto: string }).texto);
    expect(textos).toEqual(["um", "dois", "tres"]);
    await sse.fechar();
  });

  it("reconexão com Last-Event-ID reenvia só o que veio depois, inclusive o fim de uma tarefa já encerrada", async () => {
    const id = novoId();
    const { tarefa } = await iniciar(id);
    const e1 = (await t.rpc<number>(id, "publicar", "atividade", { texto: "um" }, tarefa.id))!;
    const e2 = (await t.rpc<number>(id, "publicar", "texto", { texto: "resposta" }, tarefa.id))!;
    await t.rpc(id, "terminarTarefa", "concluida", { tarefaId: tarefa.id }); // a conexão caiu antes de ver o fim
    const sse = await t.abrirSse(id, e1);
    await sse.esperar(3);
    expect(sse.eventos()).toEqual(["estado", "texto", "fim"]);
    expect(sse.quadros.find((q) => q.evento === "texto")!.id).toBe(e2);
    await sse.fechar();
    // Sem Last-Event-ID e sem tarefa ativa: só o estado (o GET da conversa já traz o resultado final).
    const limpo = await t.abrirSse(id);
    await limpo.esperar(1);
    await new Promise((r) => setTimeout(r, 200));
    expect(limpo.eventos()).toEqual(["estado"]);
    await limpo.fechar();
  });

  it("vários navegadores na mesma conversa recebem os mesmos eventos; um que sai não atrapalha os outros", async () => {
    const id = novoId();
    const [a, b] = await Promise.all([t.abrirSse(id), t.abrirSse(id)]);
    await Promise.all([a.esperar(1), b.esperar(1)]);
    await a.fechar();
    const { tarefa } = await iniciar(id);
    await t.rpc(id, "publicar", "atividade", { texto: "x" }, tarefa.id);
    await b.esperar(3);
    expect(b.eventos()).toEqual(["estado", "estado", "atividade"]);
    await b.fechar();
  });
});

describe("purga", () => {
  it("apaga caso, tarefas, eventos e alertas, fecha o SSE e recusa escritas de consumidores atrasados", async () => {
    const id = novoId();
    await t.rpc(id, "salvarCaso", { lead: { cpf: "000.000.000-00" } });
    const { tarefa } = await iniciar(id, "turno", { texto: "dado do lead" });
    await t.rpc(id, "comecarTarefa", tarefa.id, 1);
    await t.rpc(id, "publicar", "texto", { texto: "dado do lead" }, tarefa.id);
    await t.rpc(id, "alertaVisto", 60);
    const sse = await t.abrirSse(id);
    await sse.esperar(2);

    expect(await t.rpc(id, "purgar")).toEqual({ ok: true });
    await sse.terminou(); // o servidor fechou o stream

    const exec = await t.sql(id);
    for (const tabela of ["caso", "tarefa", "eventos", "alertas"]) expect(await exec(`SELECT COUNT(*) AS n FROM ${tabela}`)).toEqual([{ n: 0 }]);
    const meta = (await exec("SELECT chave FROM meta")) as { chave: string }[];
    expect(meta.map((m) => m.chave)).toEqual(["purgada"]);

    // O consumidor que ainda estava rodando não recria nada.
    expect(await t.rpc(id, "publicar", "texto", { texto: "x" }, tarefa.id)).toBeNull();
    expect(await t.rpc(id, "publicar", "texto", { texto: "x" })).toBeNull();
    expect(await t.rpc(id, "salvarCaso", { lead: "x" }, { tarefaId: tarefa.id })).toMatchObject({ ok: false, motivo: "purgada" });
    expect(await t.rpc(id, "salvarCaso", { lead: "x" })).toMatchObject({ ok: false, motivo: "purgada" });
    expect(await t.rpc(id, "terminarTarefa", "concluida", { tarefaId: tarefa.id })).toMatchObject({ ok: false, motivo: "purgada" });
    expect(await t.rpc(id, "comecarTarefa", tarefa.id, 2)).toMatchObject({ ok: false, motivo: "purgada" });
    expect(await iniciar(id)).toMatchObject({ ok: false, purgada: true });
    expect(await t.rpc(id, "obterCaso")).toMatchObject({ caso: null });
    expect(await t.rpc(id, "alertaVisto", 85)).toBeNull();
    expect(await t.rpc(id, "estado")).toMatchObject({ purgada: true, tarefa: null });
    for (const tabela of ["caso", "tarefa", "eventos", "alertas"]) expect(await exec(`SELECT COUNT(*) AS n FROM ${tabela}`)).toEqual([{ n: 0 }]);

    // Idempotente, e um SSE aberto depois só recebe o estado e fecha.
    expect(await t.rpc(id, "purgar")).toEqual({ ok: true });
    const depois = await t.abrirSse(id);
    await depois.terminou();
    expect(depois.eventos()).toEqual(["estado"]);
  });

  it("a purga de uma conversa não toca em outra", async () => {
    const [a, b] = [novoId(), novoId()];
    await t.rpc(a, "salvarCaso", { v: "a" });
    await t.rpc(b, "salvarCaso", { v: "b" });
    await t.rpc(a, "purgar");
    expect(await caso(b)).toEqual({ v: "b" });
  });
});
