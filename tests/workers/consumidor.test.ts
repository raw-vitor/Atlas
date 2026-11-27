/**
 * Consumidor da fila (turno e deck) no runtime local do Worker: D1, R2 e o Durable Object `Conversa` reais, o consumidor real
 * (`processarLote`) e dublês só do que é externo (Bedrock = servidor HTTP deste teste; Containers = Durable Objects de teste).
 * Cobre o caminho feliz, o cancelamento no meio, a reentrega da fila, falhas parciais, a conversa purgada durante a execução,
 * o limite de tarefas por isolate e uma carga de 20 conversas com 2 anexos ao mesmo tempo. `npm run test:workers`.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gravarConfigPrompt } from "../../lib/db/configPrompt";
import { listarMensagens } from "../../lib/db/mensagens";
import type { Anexo, Contexto, MensagemSalva } from "../../lib/db/tipos";
import { limiteContexto } from "../../lib/modelos";
import { chaveAnexo, chaveConversa, chaveDeck, chaveFonte } from "../../lib/r2";
import { MSG_ERRO_MODELO } from "../../lib/tarefas/execucao/erros";
import { ate, criarServidorConsumidor, type EventoDo, type ServidorConsumidor } from "./helper-consumidor";
import { iniciarMockBedrock, type MockBedrock } from "./mock-bedrock";

const fx = (n: string) => fs.readFileSync(path.join(import.meta.dirname, "../fixtures", n));
const CARTEIRA = fx("carteira_elisandro.csv");
const TRANSCRICAO = fx("transcricao_elisandro.txt");
const SEM_VALORES = fx("transcricao_sem_carteira.txt");

let mock: MockBedrock;
let t: ServidorConsumidor;
let env: CloudflareEnv;

beforeAll(async () => {
  mock = await iniciarMockBedrock();
  t = criarServidorConsumidor(mock.url);
  await t.server.listen();
  await t.worker.applyD1Migrations("DB");
  env = (await t.worker.getEnv()) as unknown as CloudflareEnv;
}, 120_000);
afterAll(async () => { await t.server.close(); await mock.fechar(); });
beforeEach(() => mock.zerar());

// ------------------------------------------------------------------ montagem: o que a rota faz antes de enfileirar

interface Conv { id: string; usuarioId: string }

async function novaConversa(email = "ana@eqi.local"): Promise<Conv> {
  const usuarioId = `u-${email}`;
  const id = randomUUID().replaceAll("-", "");
  await env.DB.prepare("INSERT OR IGNORE INTO usuarios (id, email, criado) VALUES (?, ?, 1)").bind(usuarioId, email).run();
  await env.DB.prepare("INSERT INTO conversas (id, usuario_id, criada, atualizada, ctx_limite) VALUES (?, ?, 1, 1, ?)").bind(id, usuarioId, limiteContexto()).run();
  return { id, usuarioId };
}

interface Arquivo { nome: string; conteudo: Uint8Array | string }

/** O que `POST /mensagens` faz: sobe os anexos, grava a mensagem do assessor e pega a trava no DO. Não enfileira. */
async function enviar(c: Conv, texto: string, arquivos: Arquivo[] = []) {
  const anexos: Anexo[] = [];
  for (const a of arquivos) {
    const bytes = typeof a.conteudo === "string" ? new TextEncoder().encode(a.conteudo) : a.conteudo;
    const chave = chaveAnexo(c.usuarioId, c.id, randomUUID().slice(0, 8), a.nome);
    await env.ARQUIVOS.put(chave, bytes);
    anexos.push({ chave, nome: a.nome, tamanho: bytes.length, tipo: "" });
  }
  const m = await gravarMensagemDoAssessor(c, texto, anexos);
  const r = await t.rpc<{ ok: boolean; tarefa: { id: string } }>(c.id, "iniciarTarefa", "turno", { texto, anexos, mensagemId: m.id });
  expect(r.ok).toBe(true);
  return { msg: { tipo: "turno", conversaId: c.id, usuarioId: c.usuarioId, tarefaId: r.tarefa.id }, tarefaId: r.tarefa.id, mensagemId: m.id };
}

async function gravarMensagemDoAssessor(c: Conv, texto: string, anexos: Anexo[]): Promise<MensagemSalva> {
  const { gravarMensagem } = await import("../../lib/db/mensagens");
  return gravarMensagem(env, { conversaId: c.id, tipo: "usuario", texto, meta: { anexos }, idCliente: `cli-${randomUUID()}` });
}

const pedirDeck = async (c: Conv) => {
  const r = await t.rpc<{ ok: boolean; tarefa: { id: string } }>(c.id, "iniciarTarefa", "deck", { acao: "gerar" });
  expect(r.ok).toBe(true);
  return { tipo: "deck", conversaId: c.id, usuarioId: c.usuarioId, tarefaId: r.tarefa.id };
};

const mensagens = async (c: Conv) => (await listarMensagens(env, c.usuarioId, c.id)).itens;
const nomes = (es: EventoDo[]) => es.map((e) => e.evento);
const doTipo = (es: EventoDo[], nome: string) => es.filter((e) => e.evento === nome).map((e) => e.dados);
const casoSalvo = async (c: Conv) => (await t.rpc<{ caso: Record<string, any> | null; versao: number }>(c.id, "obterCaso")).caso; // eslint-disable-line @typescript-eslint/no-explicit-any
const statusDe = async (c: Conv) => (await t.estado(c.id)).tarefa?.status;
const objetosR2 = async (c: Conv) => (await env.ARQUIVOS.list({ prefix: chaveConversa(c.usuarioId, c.id) })).objects.map((o) => o.key);
const ctxDeD1 = async (c: Conv) => (await env.DB.prepare("SELECT ctx_tokens, ctx_limite FROM conversas WHERE id = ?").bind(c.id).first<{ ctx_tokens: number; ctx_limite: number }>())!;
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** Turno completo com carteira e transcrição; devolve a conversa pronta para gerar o deck. */
async function conversaComCaso(texto = "segue o material, assessor Luiz", c?: Conv) {
  const conv = c ?? (await novaConversa());
  const { msg } = await enviar(conv, texto, [{ nome: "carteira_elisandro.csv", conteudo: CARTEIRA }, { nome: "transcricao_elisandro.txt", conteudo: TRANSCRICAO }]);
  expect(await t.lote(msg)).toEqual({ ack: true, retry: null });
  expect(await statusDe(conv)).toBe("concluida");
  return conv;
}

// ------------------------------------------------------------------ turno

describe("turno com anexos, de ponta a ponta", () => {
  it("publica os eventos na ordem, grava a resposta em D1, o texto das fontes em R2 e o caso no DO", async () => {
    const c = await novaConversa();
    const { msg, tarefaId } = await enviar(c, "segue o material, assessor Luiz", [
      { nome: "carteira_elisandro.csv", conteudo: CARTEIRA }, { nome: "transcricao_elisandro.txt", conteudo: TRANSCRICAO }]);
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null });

    const es = await t.eventos(c.id);
    expect(nomes(es)).toEqual(["contexto", "atividade", "atividade", "atividade", "texto", "caso", "contexto", "mensagem", "fim"]);
    expect(doTipo(es, "atividade")[0]).toEqual({ pct: 5, msg: "Lendo os arquivos" });
    expect(doTipo(es, "fim")).toEqual([{ status: "concluida" }]);
    expect(es.map((e) => e.id)).toEqual([...es.map((e) => e.id)].sort((a, b) => a - b));

    // Medidor: a estimativa antes de qualquer chamada, o valor real do Bedrock no fim.
    const [antes, depois] = doTipo(es, "contexto") as unknown as Contexto[];
    expect(antes.estimado).toBe(true);
    expect(depois.estimado).toBe(false);
    expect(depois.tokens).toBe(Math.max(...mock.chamadas.map((x) => x.inputTokens)));
    expect(depois.limite).toBe(limiteContexto());
    expect(depois.pct).toBe(Math.floor((depois.tokens / depois.limite) * 1000) / 10);
    expect(Object.values(depois.partes).reduce((a, b) => a + b, 0)).toBe(depois.tokens);
    expect(depois.partes.transcricao).toBeGreaterThan(0);
    expect(await ctxDeD1(c)).toEqual({ ctx_tokens: depois.tokens, ctx_limite: depois.limite });
    expect((await t.estado(c.id)).contexto).toEqual(depois);

    // D1: a mensagem do assessor e a resposta do Atlas, e o evento `mensagem` é a mesma gravada.
    const ms = await mensagens(c);
    expect(ms.map((m) => [m.seq, m.tipo])).toEqual([[1, "usuario"], [2, "atlas"]]);
    expect(ms[1].texto).toBe(doTipo(es, "texto")[0].texto);
    expect(ms[1].texto).toContain("Li 2 arquivos");
    expect(ms[1].idCliente).toBe(`atlas:${tarefaId}`);
    expect(doTipo(es, "mensagem")[0]).toMatchObject({ id: ms[1].id, seq: 2, tipo: "atlas" });

    // DO + R2: o caso sem o texto das fontes; o texto, por hash, no prefixo da conversa.
    const caso = (await casoSalvo(c))!;
    expect(caso.id).toBe(c.id);
    expect(caso.fontes.map((f: { nome: string; papel: string }) => [f.nome, f.papel])).toEqual([["carteira_elisandro.csv", "carteira"], ["transcricao_elisandro.txt", "transcricao"]]);
    expect(caso.fontes.every((f: Record<string, unknown>) => !("texto" in f))).toBe(true);
    expect(caso.analise.total).toBe(739668.62);
    expect(caso.assessor).toBe("Luiz");
    expect(caso.historico.map((h: { papel: string }) => h.papel)).toEqual(["assessor", "atlas"]);
    for (const f of caso.fontes as { hash: string }[]) {
      const o = await env.ARQUIVOS.get(chaveFonte(c.usuarioId, c.id, f.hash));
      expect(o && sha(await o.text())).toBe(f.hash);
    }
    expect((await objetosR2(c)).filter((k) => k.includes("/fontes/"))).toHaveLength(2);
    expect(mock.chamadas.map((x) => x.schema).sort()).toEqual(["AtivosOut", "Lead"]);
  });

  it("docx e pptx (Worker) e pdf (Container) no mesmo envio; o pdf recusado pelo Container vai para 'Não usei'", async () => {
    const docx = new JSZip();
    docx.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    docx.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    docx.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${
      TRANSCRICAO.toString("utf-8").split("\n").map((l) => `<w:p><w:r><w:t>${esc(l)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
    const c = await novaConversa();
    const { msg } = await enviar(c, "", [
      { nome: "reuniao_r1.docx", conteudo: await docx.generateAsync({ type: "uint8array" }) },
      { nome: "extrato.pdf", conteudo: CARTEIRA },
      { nome: "escaneado.pdf", conteudo: "FALHA422 imagem sem texto" },
    ]);
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("concluida");
    const caso = (await casoSalvo(c))!;
    expect(caso.fontes.map((f: { nome: string }) => f.nome).sort()).toEqual(["extrato.pdf", "reuniao_r1.docx"]);
    expect(caso.analise.total).toBe(739668.62);
    const resposta = (await mensagens(c))[1].texto!;
    expect(resposta).toContain("Não usei: escaneado.pdf (Não consegui extrair o texto do PDF (dublê).)");
  });

  it("o Container fora do ar na primeira chamada: repete e segue", async () => {
    const c = await novaConversa();
    const { msg } = await enviar(c, "", [{ nome: "carteira.pdf", conteudo: `INSTAVEL ${CARTEIRA.toString("utf-8")}` }, { nome: "r1.txt", conteudo: TRANSCRICAO }]);
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("concluida");
    expect((await casoSalvo(c))!.fontes).toHaveLength(2);
  });

  it("pergunta sem anexo: responde com o caso sem alterá-lo e o medidor vira o valor real da resposta", async () => {
    const c = await conversaComCaso();
    const antes = await casoSalvo(c);
    mock.zerar();
    mock.instrucao = () => ({ usar_transcricao: false, primeiro_nome: "", perfil: "", objetivos: [], pergunta: true });
    const { msg } = await enviar(c, "por que o perfil é esse?");
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null });
    const es = (await t.eventos(c.id));
    const [, depois] = doTipo(es, "contexto").slice(-2) as unknown as Contexto[];
    expect(depois.estimado).toBe(false);
    expect(depois.tokens).toBe(Math.max(...mock.chamadas.map((x) => x.inputTokens)));
    expect(mock.chamadas.map((x) => x.schema)).toEqual(["Resposta:usar_transcricao", "Resposta:resposta"]);
    const ms = await mensagens(c);
    expect(ms.slice(-1)[0].texto).toContain("Resposta do mock sobre o caso.");
    const depoisCaso = (await casoSalvo(c))!;
    expect({ ...depoisCaso, historico: undefined, atualizado: undefined }).toEqual({ ...antes, historico: undefined, atualizado: undefined });
    expect(depoisCaso.historico).toHaveLength(4);
  });

  it("mensagem não reconhecida: nenhuma chamada carrega o caso, então o medidor é estimado", async () => {
    const c = await conversaComCaso();
    mock.zerar();
    const { msg } = await enviar(c, "hmm, e aí");
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null });
    const ultimo = doTipo(await t.eventos(c.id), "contexto").slice(-1)[0] as unknown as Contexto;
    expect(ultimo.estimado).toBe(true);
    expect(ultimo.tokens).toBeGreaterThan(Math.max(...mock.chamadas.map((x) => x.inputTokens)));
    expect((await ctxDeD1(c)).ctx_tokens).toBe(ultimo.tokens);
    expect((await mensagens(c)).slice(-1)[0].texto).toContain("Não entendi o pedido.");
  });

  it("'usar a transcrição' deriva a carteira e grava o texto derivado em R2", async () => {
    const c = await novaConversa();
    const primeiro = await enviar(c, "", [{ nome: "r1.txt", conteudo: SEM_VALORES }]);
    expect(await t.lote(primeiro.msg)).toEqual({ ack: true, retry: null });
    const { msg } = await enviar(c, "usa a transcrição mesmo");
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null });
    const caso = (await casoSalvo(c))!;
    expect(caso.analise.total).toBe(600000);
    const derivada = caso.fontes.find((f: { origemPapel: string }) => f.origemPapel === "transcricao");
    expect(derivada).toBeTruthy();
    expect(await env.ARQUIVOS.head(chaveFonte(c.usuarioId, c.id, derivada.hash))).not.toBeNull();
    expect((await mensagens(c)).slice(-1)[0].texto).toContain("Montei a carteira com o que o lead disse na R1");
  });
});

// ------------------------------------------------------------------ cancelamento

describe("cancelamento", () => {
  it("no meio do turno: aborta a chamada ao Bedrock, restaura o caso, apaga a mensagem do assessor e não grava nada", async () => {
    const c = await conversaComCaso();
    const antesCaso = await casoSalvo(c);
    const antesMsgs = await mensagens(c);
    const antesCtx = await ctxDeD1(c);
    const antesR2 = await objetosR2(c);
    mock.zerar();
    mock.atrasoMs = 5000;
    const { msg, mensagemId } = await enviar(c, "mais um arquivo", [{ nome: "outra_r1.txt", conteudo: `${TRANSCRICAO.toString("utf-8")}\nOutra reunião, outro dia.` }]);
    const lote = t.lote(msg);
    await ate(async () => mock.chamadas.length, (n) => n > 0); // a chamada ao modelo está em andamento
    const inicio = Date.now();
    expect(await t.rpc(c.id, "cancelar")).toMatchObject({ ok: true, cancelando: true });
    expect(await lote).toEqual({ ack: true, retry: null });
    expect(Date.now() - inicio).toBeLessThan(3000); // não esperou os 5 s da resposta lenta

    expect(await statusDe(c)).toBe("cancelada");
    const es = await t.eventos(c.id);
    expect(doTipo(es, "fim").slice(-1)).toEqual([{ status: "cancelada" }]);
    expect(nomes(es)).not.toContain("erro");
    expect(await casoSalvo(c)).toEqual(antesCaso);
    expect(await mensagens(c)).toEqual(antesMsgs);
    expect((await mensagens(c)).some((m) => m.id === mensagemId)).toBe(false);
    expect(await ctxDeD1(c)).toEqual(antesCtx);
    // O texto das fontes novas nunca chegou ao R2 (o salvarCaso não rodou); só o anexo, que a rota subiu antes, ficou.
    expect((await objetosR2(c)).filter((k) => !k.includes("/anexos/"))).toEqual(antesR2.filter((k) => !k.includes("/anexos/")));
    expect((await objetosR2(c)).filter((k) => k.includes("/anexos/"))).toHaveLength(antesR2.filter((k) => k.includes("/anexos/")).length + 1);
    // A conversa destravou: dá para enviar de novo.
    expect((await t.rpc<{ ok: boolean }>(c.id, "iniciarTarefa", "turno", { texto: "x", anexos: [], mensagemId: "m" })).ok).toBe(true);
  });

  it("na fila, antes de o consumidor pegar: a mensagem do consumidor é descartada sem chamar o Bedrock", async () => {
    const c = await novaConversa();
    const { msg } = await enviar(c, "", [{ nome: "r1.txt", conteudo: TRANSCRICAO }]);
    expect(await t.rpc(c.id, "cancelar")).toMatchObject({ ok: true, cancelada: true });
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null });
    expect(mock.chamadas).toHaveLength(0);
    expect(await statusDe(c)).toBe("cancelada");
    expect((await mensagens(c)).filter((m) => m.tipo === "atlas")).toHaveLength(0);
  });

  it("no meio da geração do deck: corta o pedido ao Container e não grava arquivo, mensagem nem versão", async () => {
    const c = await conversaComCaso("assessor Lento"); // o dublê do Container espera o pedido ser abortado
    mock.zerar();
    const msg = await pedirDeck(c);
    const lote = t.lote(msg);
    await ate(async () => (await t.eventos(c.id)).some((e) => e.evento === "progresso" && e.dados.etapa === "deck"), Boolean);
    await t.rpc(c.id, "cancelar");
    expect(await lote).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("cancelada");
    expect((await objetosR2(c)).filter((k) => k.includes("/decks/"))).toEqual([]);
    expect((await mensagens(c)).filter((m) => m.tipo === "resultado")).toEqual([]);
    expect((await casoSalvo(c))!.decks).toEqual([]);
    expect((await casoSalvo(c))!.rascunho).toBeUndefined(); // o rascunho gerado na tarefa cancelada também volta
  });
});

// ------------------------------------------------------------------ reentrega da fila

describe("reentrega da fila (pelo menos uma vez)", () => {
  it("mensagem repetida depois de concluída não executa de novo", async () => {
    const c = await novaConversa();
    const { msg } = await enviar(c, "", [{ nome: "r1.txt", conteudo: TRANSCRICAO }]);
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null });
    const chamadas = mock.chamadas.length;
    expect(chamadas).toBeGreaterThan(0);
    expect(await t.lote(msg, 1)).toEqual({ ack: true, retry: null });
    expect(await t.lote(msg, 2)).toEqual({ ack: true, retry: null });
    expect(mock.chamadas).toHaveLength(chamadas);
    expect((await mensagens(c)).filter((m) => m.tipo === "atlas")).toHaveLength(1);
    expect(nomes(await t.eventos(c.id)).filter((n) => n === "fim")).toHaveLength(1);
  });

  it("duplicata entregue enquanto a primeira ainda roda: ack sem executar; uma só resposta", async () => {
    const c = await novaConversa();
    const { msg } = await enviar(c, "", [{ nome: "r1.txt", conteudo: TRANSCRICAO }]);
    mock.atrasoMs = 600;
    const primeira = t.lote(msg, 1);
    await ate(async () => mock.chamadas.length, (n) => n > 0);
    const emAndamento = mock.chamadas.length;
    expect(await t.lote(msg, 1)).toEqual({ ack: true, retry: null });
    expect(mock.chamadas.length).toBe(emAndamento); // a duplicata não chamou o modelo
    expect(await primeira).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("concluida");
    expect((await mensagens(c)).filter((m) => m.tipo === "atlas")).toHaveLength(1);
    expect(mock.chamadas.map((x) => x.schema)).toEqual(["Lead"]); // só a transcrição: uma extração do lead
  });

  it("o consumidor morreu depois de começar: a tentativa 1 repetida é duplicata, a 2 assume e conclui", async () => {
    const c = await novaConversa();
    const { msg, tarefaId } = await enviar(c, "", [{ nome: "r1.txt", conteudo: TRANSCRICAO }]);
    await t.rpc(c.id, "comecarTarefa", tarefaId, 1); // a invocação anterior chegou aqui e sumiu
    expect(await t.lote(msg, 1)).toEqual({ ack: true, retry: null });
    expect(mock.chamadas).toHaveLength(0);
    expect(await statusDe(c)).toBe("rodando");
    expect(await t.lote(msg, 2)).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("concluida");
    expect((await mensagens(c)).filter((m) => m.tipo === "atlas")).toHaveLength(1);
  });

  it("a resposta já gravada por uma tentativa anterior não é duplicada nem trocada", async () => {
    const c = await novaConversa();
    const { msg, tarefaId } = await enviar(c, "", [{ nome: "r1.txt", conteudo: TRANSCRICAO }]);
    const { gravarMensagem } = await import("../../lib/db/mensagens");
    const primeira = await gravarMensagem(env, { conversaId: c.id, tipo: "atlas", texto: "resposta da primeira tentativa", idCliente: `atlas:${tarefaId}` });
    await t.rpc(c.id, "comecarTarefa", tarefaId, 1); // a tentativa 1 gravou a mensagem e morreu antes de salvar o caso
    expect(await t.lote(msg, 2)).toEqual({ ack: true, retry: null });
    const atlas = (await mensagens(c)).filter((m) => m.tipo === "atlas");
    expect(atlas).toHaveLength(1);
    expect(atlas[0]).toMatchObject({ id: primeira.id, texto: "resposta da primeira tentativa" });
    expect(doTipo(await t.eventos(c.id), "mensagem")[0]).toMatchObject({ id: primeira.id });
    expect((await casoSalvo(c))!.fontes).toHaveLength(1); // o caso foi salvo, o turno não ficou pela metade
    expect(await statusDe(c)).toBe("concluida");
  });
});

// ------------------------------------------------------------------ falhas parciais

describe("falhas", () => {
  it("Bedrock fora: mensagem amigável (sem o texto do erro), caso restaurado, mensagem do Atlas com meta.erro", async () => {
    const c = await novaConversa();
    const { msg } = await enviar(c, "", [{ nome: "r1.txt", conteudo: TRANSCRICAO }]);
    mock.falhar = () => 500;
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null }); // erro tratado: sem reentrega (o assessor reenvia)
    expect(await statusDe(c)).toBe("erro");
    const es = await t.eventos(c.id);
    expect(doTipo(es, "erro")).toEqual([{ mensagem: MSG_ERRO_MODELO }]);
    expect(nomes(es).slice(-3)).toEqual(["mensagem", "erro", "fim"]);
    expect(doTipo(es, "fim").slice(-1)).toEqual([{ status: "erro" }]);
    const ms = await mensagens(c);
    expect(ms.map((m) => m.tipo)).toEqual(["usuario", "atlas"]);
    expect(ms[1]).toMatchObject({ texto: MSG_ERRO_MODELO, meta: { erro: true } });
    expect(JSON.stringify(ms)).not.toContain("falha simulada"); // o texto cru do Bedrock não chega à tela
    expect(await casoSalvo(c)).toBeNull();
    expect((await objetosR2(c)).filter((k) => k.includes("/fontes/"))).toEqual([]);
    expect(await ctxDeD1(c)).toMatchObject({ ctx_tokens: 0 });
    // Destravou: um novo turno funciona.
    mock.falhar = undefined;
    const outra = await enviar(c, "", [{ nome: "r1.txt", conteudo: TRANSCRICAO }]);
    expect(await t.lote(outra.msg)).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("concluida");
  }, 60_000);

  it("anexo que não está no R2: erro com o nome do arquivo e nada alterado", async () => {
    const c = await novaConversa();
    const anexos: Anexo[] = [{ chave: chaveAnexo(c.usuarioId, c.id, "x", "sumiu.txt"), nome: "sumiu.txt", tamanho: 10, tipo: "" }];
    const m = await gravarMensagemDoAssessor(c, "", anexos);
    const r = await t.rpc<{ tarefa: { id: string } }>(c.id, "iniciarTarefa", "turno", { texto: "", anexos, mensagemId: m.id });
    expect(await t.lote({ tipo: "turno", conversaId: c.id, usuarioId: c.usuarioId, tarefaId: r.tarefa.id })).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("erro");
    expect((await mensagens(c))[1].texto).toBe('Não encontrei o anexo "sumiu.txt". Anexe de novo.');
    expect(mock.chamadas).toHaveLength(0);
  });

  it("chave de anexo de outra conversa ou de outro usuário nunca é lida", async () => {
    const dona = await novaConversa("dona@eqi.local");
    const c = await novaConversa("intruso@eqi.local");
    const chaveAlheia = chaveAnexo(dona.usuarioId, dona.id, "z", "segredo.txt");
    await env.ARQUIVOS.put(chaveAlheia, "CPF 123.456.789-00 posição do cliente da outra conversa");
    const anexos: Anexo[] = [{ chave: chaveAlheia, nome: "segredo.txt", tamanho: 50, tipo: "" }];
    const m = await gravarMensagemDoAssessor(c, "", anexos);
    const r = await t.rpc<{ tarefa: { id: string } }>(c.id, "iniciarTarefa", "turno", { texto: "", anexos, mensagemId: m.id });
    expect(await t.lote({ tipo: "turno", conversaId: c.id, usuarioId: c.usuarioId, tarefaId: r.tarefa.id })).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("erro");
    expect(mock.chamadas).toHaveLength(0);
    expect(JSON.stringify(await t.eventos(c.id)) + JSON.stringify(await mensagens(c))).not.toContain("123.456.789-00");
    expect((await objetosR2(c)).filter((k) => k.includes("/fontes/"))).toEqual([]);
  });

  it("payload da tarefa fora do formato: erro amigável, sem exceção para a fila", async () => {
    const c = await novaConversa();
    const r = await t.rpc<{ tarefa: { id: string } }>(c.id, "iniciarTarefa", "turno", { foo: 1 });
    expect(await t.lote({ tipo: "turno", conversaId: c.id, usuarioId: c.usuarioId, tarefaId: r.tarefa.id })).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("erro");
    expect((await mensagens(c))[0]).toMatchObject({ tipo: "atlas", meta: { erro: true } });
  });

  it("conversa purgada durante a execução: o consumidor para sem recriar nada", async () => {
    const c = await novaConversa();
    const { msg } = await enviar(c, "", [{ nome: "r1.txt", conteudo: TRANSCRICAO }]);
    mock.atrasoMs = 3000;
    const lote = t.lote(msg);
    await ate(async () => mock.chamadas.length, (n) => n > 0);
    await t.rpc(c.id, "purgar");
    expect(await lote).toEqual({ ack: true, retry: null });
    expect((await mensagens(c)).filter((m) => m.tipo === "atlas")).toHaveLength(0);
    expect(await casoSalvo(c)).toBeNull();
    expect((await objetosR2(c)).filter((k) => k.includes("/fontes/"))).toEqual([]);
    expect((await t.rpc<{ purgada: boolean }>(c.id, "estado")).purgada).toBe(true);
  });

  it("mensagem da fila com corpo inválido sobe para a fila de mortas (retry), nunca ack", async () => {
    const r = await t.lote({ tipo: "turno", conversaId: "", usuarioId: "u" });
    expect(r.ack).toBe(false);
    expect(r.retry).not.toBeNull();
  });
});

// ------------------------------------------------------------------ deck

describe("deck", () => {
  it("gera o rascunho, grava v1.pptx e v1.pdf em R2, a mensagem 'resultado' em D1 e a versão no caso", async () => {
    const c = await conversaComCaso();
    mock.zerar();
    const msg = await pedirDeck(c);
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("concluida");

    const es = (await t.eventos(c.id)).filter((e) => e.id > 0);
    const deDeck = es.slice(es.findIndex((e) => e.dados && e.evento === "progresso"));
    const progresso = doTipo(deDeck, "progresso") as { etapa: string; pct: number; msg: string }[];
    expect(progresso.map((p) => p.etapa)).toEqual(["alocacao", "diagnostico", "roteiro", "validacao", "deck", "fim"]);
    expect(progresso.map((p) => p.pct)).toEqual([...progresso.map((p) => p.pct)].sort((a, b) => a - b));
    expect(nomes(deDeck).filter((n) => n !== "progresso")).toEqual(["caso", "contexto", "mensagem", "fim"]);
    expect(mock.chamadas.map((x) => x.schema)).toEqual(["Alocacao", "Diagnostico", "Decisao", "Notas"]);

    const pptx = await env.ARQUIVOS.get(chaveDeck(c.usuarioId, c.id, 1, "pptx"));
    const pdf = await env.ARQUIVOS.get(chaveDeck(c.usuarioId, c.id, 1, "pdf"));
    expect(await pptx!.text()).toMatch(/^PK-FAKE:Elisandro_R2_\d{8}_Luiz$/);
    expect(await pdf!.text()).toMatch(/^%PDF-FAKE:Elisandro_R2_\d{8}_Luiz$/);
    expect(pptx!.httpMetadata?.contentType).toContain("presentationml");

    const resultado = (await mensagens(c)).slice(-1)[0];
    expect(resultado).toMatchObject({ tipo: "resultado", meta: { versao: 1 } });
    expect(resultado.meta!.resultado!.arquivos).toEqual({
      pptx: `/api/conversas/${c.id}/decks/1?fmt=pptx`, pdf: `/api/conversas/${c.id}/decks/1?fmt=pdf` });
    expect(resultado.meta!.resultado!.resumo).toEqual({ lead: "Elisandro", total: 739668.62, perfil: expect.any(String) });
    expect(doTipo(deDeck, "mensagem")[0]).toMatchObject({ id: resultado.id });
    const caso = (await casoSalvo(c))!;
    expect(caso.decks).toEqual([{ jobId: msg.tarefaId, versao: 1, criadoEm: expect.any(Number) }]);
    expect(caso.rascunho).toBeTruthy();
    expect(doTipo(deDeck, "caso")[0]).toMatchObject({ rascunhoPronto: true, decks: [{ versao: 1 }] });
  });

  it("segundo deck reaproveita o rascunho (sem chamar o modelo) e vira a versão 2", async () => {
    const c = await conversaComCaso();
    expect(await t.lote(await pedirDeck(c))).toEqual({ ack: true, retry: null });
    mock.zerar();
    expect(await t.lote(await pedirDeck(c))).toEqual({ ack: true, retry: null });
    expect(mock.chamadas).toHaveLength(0);
    expect((await casoSalvo(c))!.decks.map((d: { versao: number }) => d.versao)).toEqual([1, 2]);
    expect(await env.ARQUIVOS.head(chaveDeck(c.usuarioId, c.id, 2, "pdf"))).not.toBeNull();
    expect((await mensagens(c)).filter((m) => m.tipo === "resultado").map((m) => m.meta!.versao)).toEqual([1, 2]);
  });

  it("caso incompleto: erro dizendo o que falta, sem chamar o modelo nem o Container", async () => {
    const c = await novaConversa();
    expect(await t.lote(await pedirDeck(c))).toEqual({ ack: true, retry: null });
    expect(await statusDe(c)).toBe("erro");
    expect((await mensagens(c))[0]).toMatchObject({ tipo: "atlas", meta: { erro: true } });
    expect((await mensagens(c))[0].texto).toMatch(/^Ainda falta: /);
    expect(mock.chamadas).toHaveLength(0);
  });

  it("reentrega depois de concluída não gera outra versão", async () => {
    const c = await conversaComCaso();
    const msg = await pedirDeck(c);
    await t.lote(msg);
    mock.zerar();
    expect(await t.lote(msg, 2)).toEqual({ ack: true, retry: null });
    expect((await casoSalvo(c))!.decks).toHaveLength(1);
    expect(mock.chamadas).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ configuração de prompt do assessor

describe("configuração de prompt por assessor (turno e deck)", () => {
  const EXTRA_A = "INSTRUCAO-PROPRIA-DA-ANA-7F3A";
  const EXTRA_A2 = "INSTRUCAO-DEPOIS-DE-SALVAR-9C1B";
  const bloco = (texto: string) => ({ id: "x_aaaaaaaaaaaa", categoria: "geral" as const, titulo: "Meu bloco", texto, ativo: true, ordem: 0 });
  /** Grava como a rota PUT faz: a versão esperada é a atual. Devolve a nova. */
  const salvarConfig = async (usuarioId: string, versaoAtual: number, texto: string) => {
    const v = await gravarConfigPrompt(env, usuarioId, versaoAtual, { alterados: {}, extras: [bloco(texto)] });
    expect(v).toBe(versaoAtual + 1);
    return v!;
  };
  const versoes = async (c: Conv) => (await casoSalvo(c))!.configVersoes;
  const systems = () => mock.chamadas.map((x) => x.system);

  it("o extra de A entra no system do lead e do rascunho de A e em nenhum de B; o caso grava a versão usada", async () => {
    const a = await novaConversa("cfg.ana@eqi.local");
    const b = await novaConversa("cfg.bia@eqi.local");
    await salvarConfig(a.usuarioId, await salvarConfig(a.usuarioId, 0, "rascunho antigo"), EXTRA_A); // versão 2

    // Leitura do lead (turno): A leva o extra, B não.
    await conversaComCaso("segue o material, assessor Luiz", a);
    expect(mock.chamadas.map((x) => x.schema).sort()).toEqual(["AtivosOut", "Lead"]);
    expect(systems().every((s) => s.includes(EXTRA_A))).toBe(true);
    expect(await versoes(a)).toEqual({ lead: 2 });
    mock.zerar();
    await conversaComCaso("segue o material, assessor Luiz", b);
    expect(systems().some((s) => s.includes(EXTRA_A))).toBe(false);
    expect(await versoes(b)).toEqual({ lead: 0 });

    // Rascunho (deck): as quatro chamadas de A levam o extra, as de B não.
    mock.zerar();
    expect(await t.lote(await pedirDeck(a))).toEqual({ ack: true, retry: null });
    expect(mock.chamadas.map((x) => x.schema)).toEqual(["Alocacao", "Diagnostico", "Decisao", "Notas"]);
    expect(systems().every((s) => s.includes(EXTRA_A))).toBe(true);
    mock.zerar();
    expect(await t.lote(await pedirDeck(b))).toEqual({ ack: true, retry: null });
    expect(mock.chamadas).toHaveLength(4);
    expect(systems().some((s) => s.includes(EXTRA_A))).toBe(false);

    expect(await versoes(a)).toEqual({ lead: 2, rascunho: 2 });
    expect(await versoes(b)).toEqual({ lead: 0, rascunho: 0 });
    const eventoCaso = doTipo(await t.eventos(a.id), "caso").slice(-1)[0];
    expect(eventoCaso).toMatchObject({ rascunhoPronto: true, configVersoes: { lead: 2, rascunho: 2 } });
  });

  it("snapshot: salvar a config no meio do deck não muda o que a tarefa em andamento usa nem a versão gravada", async () => {
    const a = await novaConversa("cfg.snap@eqi.local");
    const v1 = await salvarConfig(a.usuarioId, 0, EXTRA_A);
    await conversaComCaso("segue o material, assessor Luiz", a);
    mock.zerar();
    mock.atrasoMs = 150;
    const lote = t.lote(await pedirDeck(a));
    await ate(async () => mock.chamadas.length, (n) => n >= 1); // a primeira chamada do rascunho já saiu com a config lida
    await salvarConfig(a.usuarioId, v1, EXTRA_A2);
    expect(await lote).toEqual({ ack: true, retry: null });
    expect(mock.chamadas).toHaveLength(4);
    expect(systems().every((s) => s.includes(EXTRA_A) && !s.includes(EXTRA_A2))).toBe(true);
    expect(await versoes(a)).toEqual({ lead: v1, rascunho: v1 });
  });

  it("deck que reaproveita o rascunho não chama o modelo nem muda a versão gravada", async () => {
    const a = await novaConversa("cfg.reuso@eqi.local");
    const v1 = await salvarConfig(a.usuarioId, 0, EXTRA_A);
    await conversaComCaso("segue o material, assessor Luiz", a);
    expect(await t.lote(await pedirDeck(a))).toEqual({ ack: true, retry: null });
    await salvarConfig(a.usuarioId, v1, EXTRA_A2);
    mock.zerar();
    expect(await t.lote(await pedirDeck(a))).toEqual({ ack: true, retry: null });
    expect(mock.chamadas).toHaveLength(0);
    expect(await versoes(a)).toEqual({ lead: v1, rascunho: v1 }); // a atual (v2) é outra: é isso que o alerta da tela mostra
  });

  it("transcrição nova refaz o lead com a config atual; o rascunho antigo e a versão dele somem", async () => {
    const a = await novaConversa("cfg.refaz@eqi.local");
    const v1 = await salvarConfig(a.usuarioId, 0, EXTRA_A);
    await conversaComCaso("segue o material, assessor Luiz", a);
    expect(await t.lote(await pedirDeck(a))).toEqual({ ack: true, retry: null });
    expect(await versoes(a)).toEqual({ lead: v1, rascunho: v1 });
    const v2 = await salvarConfig(a.usuarioId, v1, EXTRA_A2);
    mock.zerar();
    const { msg } = await enviar(a, "", [{ nome: "outra_r1.txt", conteudo: `${TRANSCRICAO.toString("utf-8")}\nOutra reunião, outro dia.` }]);
    expect(await t.lote(msg)).toEqual({ ack: true, retry: null });
    const caso = (await casoSalvo(a))!;
    expect(caso.rascunho).toBeUndefined();
    expect(caso.configVersoes).toEqual({ lead: v2 }); // sem a chave `rascunho`
    expect(mock.chamadas.some((x) => x.schema === "Lead" && x.system.includes(EXTRA_A2))).toBe(true);
    expect(doTipo(await t.eventos(a.id), "caso").slice(-1)[0]).toMatchObject({ rascunhoPronto: false, configVersoes: { lead: v2 } });
  });

  it("falha ao ler a config: segue com o prompt original e grava versão 0 (o alerta da tela avisa, pois a atual é outra)", async () => {
    const a = await novaConversa("cfg.falha@eqi.local");
    await salvarConfig(a.usuarioId, 0, EXTRA_A);
    await env.DB.prepare("ALTER TABLE config_prompt RENAME TO config_prompt_fora").run();
    try {
      await conversaComCaso("segue o material, assessor Luiz", a);
      mock.zerar();
      expect(await t.lote(await pedirDeck(a))).toEqual({ ack: true, retry: null });
      expect(await statusDe(a)).toBe("concluida");
      expect(systems().some((s) => s.includes(EXTRA_A))).toBe(false);
      expect((await casoSalvo(a))!.decks).toHaveLength(1);
      expect(await versoes(a)).toEqual({ lead: 0, rascunho: 0 });
    } finally {
      await env.DB.prepare("ALTER TABLE config_prompt_fora RENAME TO config_prompt").run();
    }
  });
});

// ------------------------------------------------------------------ limite por isolate e carga

describe("fila e carga", () => {
  it("passou do limite de tarefas por isolate: as demais esperam como 'na fila' e recebem a posição", async () => {
    mock.atrasoMs = 400;
    const conversas = await Promise.all(Array.from({ length: 6 }, () => novaConversa()));
    const msgs = await Promise.all(conversas.map((c) => enviar(c, "", [{ nome: "r1.txt", conteudo: TRANSCRICAO }])));
    const resultados = await Promise.all(msgs.map((m) => t.lote(m.msg)));
    expect(resultados.every((r) => r.ack && !r.retry)).toBe(true);
    expect(await Promise.all(conversas.map(statusDe))).toEqual(Array(6).fill("concluida"));
    const filas = (await Promise.all(conversas.map((c) => t.eventos(c.id)))).flatMap((es) => doTipo(es, "fila")) as { posicao: number }[];
    expect(filas.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...filas.map((f) => f.posicao))).toBeLessThanOrEqual(3);
    expect(Math.min(...filas.map((f) => f.posicao))).toBe(1);
  });

  /** 20 conversas, cada uma com carteira e transcrição, prontas para o consumidor (a rota já gravou e pegou a trava). */
  async function prepararCarga(n: number) {
    const conversas = await Promise.all(Array.from({ length: n }, (_, i) => novaConversa(`carga${i % 4}@eqi.local`)));
    const envios = await Promise.all(conversas.map((c, i) => enviar(c, `assessor Carga${String.fromCharCode(65 + i)}`, [
      { nome: "carteira_elisandro.csv", conteudo: CARTEIRA },
      { nome: "transcricao_elisandro.txt", conteudo: `${TRANSCRICAO.toString("utf-8")}\nReunião número ${i}.` }])));
    return { conversas, envios };
  }

  /** Cada conversa terminou bem, com uma resposta, o caso dela e só o texto das fontes dela em R2. */
  async function conferirCarga(conversas: Conv[]) {
    expect(await Promise.all(conversas.map(statusDe))).toEqual(Array(conversas.length).fill("concluida"));
    for (const [i, c] of conversas.entries()) {
      const ms = await mensagens(c);
      expect(ms.map((m) => m.tipo)).toEqual(["usuario", "atlas"]);
      expect(ms[1].meta?.erro).toBeUndefined();
      const caso = (await casoSalvo(c))!;
      expect(caso.id).toBe(c.id);
      expect(caso.assessor).toBe(`Carga${String.fromCharCode(65 + i)}`);
      expect(caso.analise.total).toBe(739668.62);
      const fontes = (await objetosR2(c)).filter((k) => k.includes("/fontes/"));
      expect(fontes).toHaveLength(2);
      expect(fontes.every((k) => k.startsWith(chaveConversa(c.usuarioId, c.id)))).toBe(true);
      expect(nomes(await t.eventos(c.id))).not.toContain("erro");
    }
    expect(mock.chamadas).toHaveLength(conversas.length * 2); // 1 extração de ativos + 1 de lead por conversa, sem repetição
  }

  it("20 conversas com 2 anexos entregues ao mesmo tempo ao mesmo isolate: nenhuma falha e no máximo 3 turnos simultâneos", async () => {
    mock.atrasoMs = 100;
    const { conversas, envios } = await prepararCarga(20);
    const r = await Promise.all(envios.map((e) => t.lote(e.msg)));
    expect(r.every((x) => x.ack && !x.retry)).toBe(true);
    await conferirCarga(conversas);
    // O limite por isolate (3) segura os turnos simultâneos; cada turno faz até 2 chamadas em paralelo ao Bedrock.
    expect(mock.maxSimultaneas).toBeLessThanOrEqual(3 * 2);
    expect(mock.maxSimultaneas).toBeGreaterThanOrEqual(2);
    const filas = (await Promise.all(conversas.map((c) => t.eventos(c.id)))).flatMap((es) => doTipo(es, "fila")) as { posicao: number }[];
    expect(Math.max(...filas.map((f) => f.posicao))).toBeGreaterThanOrEqual(10); // chegaram a esperar ~17 atrás de 3
  }, 150_000);

  it("20 conversas com 2 anexos pela fila real (Queues do miniflare): nenhuma falha, nada na fila de mortas", async () => {
    mock.atrasoMs = 60;
    const { conversas, envios } = await prepararCarga(20);
    await Promise.all(envios.map((e) => t.enfileirar(e.msg)));
    await ate(() => Promise.all(conversas.map(statusDe)), (ss) => ss.every((s) => s === "concluida" || s === "erro"), 100_000);
    await conferirCarga(conversas);
  }, 150_000);
});
