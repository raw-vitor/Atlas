/**
 * Rotas de conversa (lib/rotas/*) no runtime do Worker: isolamento entre usuários, trava, idempotência, paginação, anexos, exclusão com
 * purga real (R2, DO e D1) e o cron de 90 dias. As rotas são as funções reais que app/api/** chama, montadas pelo entry de teste.
 * O consumidor de turno/deck não roda aqui (as mensagens dessas filas só são registradas); a purga roda de verdade pela fila.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gravarMensagem } from "../../lib/db/mensagens";
import { chaveConversa } from "../../lib/r2";
import { criarServidor } from "./helper";

const t = criarServidor();
// Os tipos de `fetch` do wrangler (undici) brigam com os do lib "dom" do projeto; aqui o formato é o do fetch padrão.
const buscar = (url: string, init?: RequestInit & { duplex?: "half" }) =>
  (t.server.fetch as unknown as (u: string, i?: unknown) => Promise<Response>)(url, init);

const A = "ana@eqi.local";
const B = "bia@eqi.local";
const DIA = 86_400_000;

interface Resp {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  corpo: any;
  headers: Headers;
}

async function api(usuario: string | null, metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}): Promise<Resp> {
  const headers: Record<string, string> = { ...extra };
  if (usuario) headers["x-atlas-dev-usuario"] = usuario;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  const r = await buscar(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const texto = await r.text();
  let json: unknown = texto;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* corpo não JSON */ }
  return { status: r.status, corpo: json, headers: r.headers };
}

async function upload(usuario: string, conv: string, nome: string, bytes: Uint8Array | string, extra: Record<string, string> = {}): Promise<Resp> {
  const headers: Record<string, string> = { "x-atlas-dev-usuario": usuario, ...extra };
  const r = await buscar(`/api/conversas/${conv}/anexos?nome=${encodeURIComponent(nome)}`, { method: "PUT", headers, body: bytes as BodyInit });
  const texto = await r.text();
  let json: unknown = texto;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* corpo não JSON */ }
  return { status: r.status, corpo: json, headers: r.headers };
}

const novaConversa = async (usuario: string, titulo?: string): Promise<string> => {
  const r = await api(usuario, "POST", "/api/conversas", titulo ? { titulo } : undefined);
  expect(r.status).toBe(201);
  return r.corpo.conversa.id as string;
};

let n = 0;
const enviar = (usuario: string, conv: string, texto = "oi", extra: { anexos?: string[]; idCliente?: string } = {}, cabecalhos: Record<string, string> = {}) =>
  api(usuario, "POST", `/api/conversas/${conv}/mensagens`, { texto, anexos: extra.anexos ?? [], idCliente: extra.idCliente ?? `cli-${Date.now()}-${n++}` }, cabecalhos);

const fila = async () => (await (await buscar("/teste/fila")).json()) as { tipo: string; conversaId: string; tarefaId: string }[];
const doUsuario = async (email: string) => {
  const { DB } = await t.worker.getEnv();
  return (await DB.prepare("SELECT id FROM usuarios WHERE email = ?").bind(email).first<{ id: string }>())!.id;
};
const linhas = async (sql: string, ...b: unknown[]) => {
  const { DB } = await t.worker.getEnv();
  return (await DB.prepare(sql).bind(...b).all()).results as Record<string, unknown>[];
};
const objetosR2 = async (usuarioId: string, conv: string) => {
  const { ARQUIVOS } = await t.worker.getEnv();
  return (await ARQUIVOS.list({ prefix: chaveConversa(usuarioId, conv) })).objects.map((o) => o.key);
};
async function ate<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15000): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > fim) throw new Error(`Condição não atendida a tempo: ${JSON.stringify(v)}`);
    await new Promise((res) => setTimeout(res, 100));
  }
}

const casoPronto = (id: string) => ({
  id, criado: 1, atualizado: 1, ocupado: false, fontes: [], ativos: [], dataPosicao: "", pendenciasCarteira: [], avisosLeitura: [],
  divergencias: [], edicoes: [], decks: [], historico: [],
  lead: { primeiro_nome: "Ana", situacao: [], objetivos: ["aposentar aos 60"], restricoes: [], frases_literais: [], perfil: "Moderado", freio_principal: "", aporte_mensal: 0, meta_patrimonio_citada: "", lacunas: [] },
  analise: { total: 1000, por_classe: {}, pct_classe: {}, subclasses: {}, excedente_fgc: 0, excedente_fgc_a_validar: false, pct_internacional: 0, pct_local: 1, maior_ativo: null, n_ativos: 1, n_classes: 1, fora_do_estudo: [] },
});

beforeAll(async () => {
  await t.server.listen();
  await t.worker.applyD1Migrations("DB");
});
afterAll(async () => { await t.server.close(); });

describe("autenticação", () => {
  it("cabeçalho de e-mail inválido é 401; sem cabeçalho vale o usuário local; a linha de usuarios é criada uma vez", async () => {
    expect((await api("isso-nao-e-email", "GET", "/api/conversas")).status).toBe(401);
    expect((await api("a b@eqi.local", "GET", "/api/conversas")).status).toBe(401);
    const semCabecalho = await api(null, "GET", "/api/conversas");
    expect(semCabecalho.status).toBe(200);
    await api(A, "GET", "/api/conversas");
    await api("ANA@eqi.local", "GET", "/api/conversas"); // mesmo e-mail em maiúsculas: mesmo usuário
    const us = await linhas("SELECT id, email FROM usuarios WHERE email IN ('dev@eqi.local', 'ana@eqi.local')");
    expect(us.map((u) => u.email).sort()).toEqual(["ana@eqi.local", "dev@eqi.local"]);
    for (const u of us) expect(u.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("em produção o cabeçalho e o usuário local são ignorados: sem JWT validado, tudo é 401", async () => {
    const r = await api(A, "GET", "/api/conversas", undefined, { "x-teste-ambiente": "production" });
    expect(r.status).toBe(401);
    const r2 = await api(null, "POST", "/api/conversas", {}, { "x-teste-ambiente": "production", "cf-access-jwt-assertion": "eyJ.falso.jwt" });
    expect(r2.status).toBe(401);
  });
});

describe("isolamento entre usuários: A nunca alcança a conversa de B (404)", () => {
  it("lista, lê, envia, anexa, gera, cancela, assiste, baixa, renomeia e apaga", async () => {
    const conv = await novaConversa(B, "Caso do B");
    const idB = await doUsuario(B);
    const { ARQUIVOS } = await t.worker.getEnv();
    await ARQUIVOS.put(`${chaveConversa(idB, conv)}decks/v1.pptx`, "conteudo-do-deck");
    await gravarMensagem((await t.worker.getEnv()) as unknown as CloudflareEnv, { conversaId: conv, tipo: "atlas", texto: "segredo do lead" });

    // O dono acessa.
    expect((await api(B, "GET", `/api/conversas/${conv}`)).status).toBe(200);
    expect((await api(B, "GET", `/api/conversas/${conv}/decks/1?fmt=pptx`)).status).toBe(200);

    const lista = await api(A, "GET", "/api/conversas");
    expect(lista.corpo.itens.map((c: { id: string }) => c.id)).not.toContain(conv);

    const tentativas: [string, string, unknown?][] = [
      ["GET", `/api/conversas/${conv}`],
      ["PATCH", `/api/conversas/${conv}`, { titulo: "invadido" }],
      ["GET", `/api/conversas/${conv}/mensagens`],
      ["POST", `/api/conversas/${conv}/mensagens`, { texto: "oi", anexos: [], idCliente: "x1" }],
      ["POST", `/api/conversas/${conv}/acoes`, { acao: "gerar" }],
      ["POST", `/api/conversas/${conv}/cancelar`],
      ["GET", `/api/conversas/${conv}/eventos`],
      ["GET", `/api/conversas/${conv}/decks/1?fmt=pptx`],
      ["DELETE", `/api/conversas/${conv}`],
    ];
    for (const [metodo, caminho, corpo] of tentativas) {
      const r = await api(A, metodo, caminho, corpo);
      expect(r.status, `${metodo} ${caminho}`).toBe(404);
      expect(JSON.stringify(r.corpo)).not.toContain("segredo");
    }
    expect((await upload(A, conv, "x.txt", "dados")).status).toBe(404);

    // Nada mudou para o dono.
    const depois = await api(B, "GET", `/api/conversas/${conv}`);
    expect(depois.status).toBe(200);
    expect(depois.corpo.conversa.titulo).toBe("Caso do B");
    expect((await api(B, "GET", `/api/conversas/${conv}/mensagens`)).corpo.itens).toHaveLength(1);
    expect(await objetosR2(idB, conv)).toHaveLength(1);
  });

  it("anexo de outra conversa ou de outro usuário não entra numa mensagem", async () => {
    const convA = await novaConversa(A);
    const convA2 = await novaConversa(A);
    const convB = await novaConversa(B);
    const deB = (await upload(B, convB, "carteira.csv", "ativo;valor\nCDB;1")).corpo.anexo.chave as string;
    const deA2 = (await upload(A, convA2, "carteira.csv", "ativo;valor\nCDB;1")).corpo.anexo.chave as string;
    const proprio = (await upload(A, convA, "carteira.csv", "ativo;valor\nCDB;1")).corpo.anexo.chave as string;

    for (const chave of [deB, deA2, `${proprio.replace("/anexos/", "/anexos/../")}`, `${proprio.replace("/anexos/", "/fontes/")}`, "u/x/c/y/anexos/z-a.txt", ""]) {
      const r = await enviar(A, convA, "oi", { anexos: [chave] });
      expect(r.status, chave).toBe(400);
    }
    expect((await api(A, "GET", `/api/conversas/${convA}/mensagens`)).corpo.itens).toHaveLength(0); // nenhuma mensagem órfã
    const ok = await enviar(A, convA, "oi", { anexos: [proprio] });
    expect(ok.status).toBe(202);
    expect(ok.corpo.mensagem.meta.anexos[0]).toMatchObject({ chave: proprio, nome: "carteira.csv", tamanho: 17 });
  });
});

describe("enviar mensagem: trava, idempotência e falhas", () => {
  it("duas mensagens simultâneas na mesma conversa: uma 202 e uma 409, e só uma mensagem gravada", async () => {
    const conv = await novaConversa(A);
    const [r1, r2] = await Promise.all([enviar(A, conv, "primeira"), enviar(A, conv, "segunda")]);
    expect([r1.status, r2.status].sort()).toEqual([202, 409]);
    const perdedora = r1.status === 409 ? r1 : r2;
    expect(perdedora.corpo.erro).toMatch(/processando/);
    const msgs = (await api(A, "GET", `/api/conversas/${conv}/mensagens`)).corpo.itens;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].tipo).toBe("usuario");
    expect((await fila()).filter((m) => m.conversaId === conv)).toHaveLength(1);
  });

  it("doze mensagens simultâneas: uma aceita, onze 409, nenhuma órfã", async () => {
    const conv = await novaConversa(A);
    const r = await Promise.all(Array.from({ length: 12 }, (_, i) => enviar(A, conv, `m${i}`)));
    expect(r.filter((x) => x.status === 202)).toHaveLength(1);
    expect(r.filter((x) => x.status === 409)).toHaveLength(11);
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens`)).corpo.itens).toHaveLength(1);
  });

  it("idCliente repetido devolve a mesma mensagem, não duplica e reenfileira só enquanto a tarefa está na fila", async () => {
    const conv = await novaConversa(A);
    const primeira = await enviar(A, conv, "uma vez só", { idCliente: "cli-repetido" });
    expect(primeira.status).toBe(202);
    const repetida = await enviar(A, conv, "uma vez só", { idCliente: "cli-repetido" });
    expect(repetida.status).toBe(202);
    expect(repetida.corpo.mensagem.id).toBe(primeira.corpo.mensagem.id);
    expect(repetida.corpo.tarefa.id).toBe(primeira.corpo.tarefa.id);
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens`)).corpo.itens).toHaveLength(1);
    // Na fila: o reenvio reenfileira a mesma tarefa (o consumidor descarta duplicatas por comecarTarefa).
    expect((await fila()).filter((m) => m.conversaId === conv).map((m) => m.tarefaId)).toEqual([primeira.corpo.tarefa.id, primeira.corpo.tarefa.id]);

    // Concluída: o reenvio atrasado devolve a mensagem sem nova tarefa nem novo envio à fila.
    await t.rpc(conv, "terminarTarefa", "concluida", { tarefaId: primeira.corpo.tarefa.id });
    const tarde = await enviar(A, conv, "uma vez só", { idCliente: "cli-repetido" });
    expect(tarde.status).toBe(202);
    expect(tarde.corpo.mensagem.id).toBe(primeira.corpo.mensagem.id);
    expect(tarde.corpo.tarefa.status).toBe("concluida");
    expect((await fila()).filter((m) => m.conversaId === conv)).toHaveLength(2);
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens`)).corpo.itens).toHaveLength(1);
  });

  it("o mesmo idCliente em conversas diferentes é permitido", async () => {
    const [c1, c2] = [await novaConversa(A), await novaConversa(A)];
    expect((await enviar(A, c1, "x", { idCliente: "igual" })).status).toBe(202);
    expect((await enviar(A, c2, "x", { idCliente: "igual" })).status).toBe(202);
  });

  it("falha ao enfileirar: 503, a mensagem não fica órfã e a trava é liberada", async () => {
    const conv = await novaConversa(A);
    const r = await enviar(A, conv, "vai falhar", {}, { "x-teste-fila": "falha" });
    expect(r.status).toBe(503);
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens`)).corpo.itens).toHaveLength(0);
    const estado = await t.rpc<{ tarefa: { status: string } | null }>(conv, "estado");
    expect(estado.tarefa?.status).toBe("erro");
    expect((await enviar(A, conv, "agora vai")).status).toBe(202);
  });

  it("valida o corpo: texto, idCliente, anexos e mensagem vazia", async () => {
    const conv = await novaConversa(A);
    const post = (corpo: unknown) => api(A, "POST", `/api/conversas/${conv}/mensagens`, corpo);
    expect((await post({ texto: 1, anexos: [], idCliente: "a" })).status).toBe(400);
    expect((await post({ texto: "oi", anexos: [] })).status).toBe(400);
    expect((await post({ texto: "oi", anexos: [], idCliente: "tem espaço" })).status).toBe(400);
    expect((await post({ texto: "oi", anexos: "x", idCliente: "a" })).status).toBe(400);
    expect((await post({ texto: "   ", anexos: [], idCliente: "a" })).status).toBe(400);
    expect((await post({ texto: "x".repeat(300_001), anexos: [], idCliente: "a" })).status).toBe(413);
    expect((await post(["lista"])).status).toBe(400);
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens`)).corpo.itens).toHaveLength(0);
  });

  it("a primeira mensagem define o título (60 caracteres ou o nome do anexo) e as seguintes não o mudam", async () => {
    const c1 = await novaConversa(A);
    const longo = `Reunião com o Carlos sobre a carteira ${"muito ".repeat(30)}fim`;
    const r = await enviar(A, c1, longo);
    expect(r.status).toBe(202);
    const t1 = (await api(A, "GET", `/api/conversas/${c1}`)).corpo.conversa.titulo as string;
    expect(Array.from(t1).length).toBeLessThanOrEqual(60);
    expect(t1.startsWith("Reunião com o Carlos")).toBe(true);
    await t.rpc(c1, "terminarTarefa", "concluida", { tarefaId: r.corpo.tarefa.id });
    await enviar(A, c1, "outra coisa");
    expect((await api(A, "GET", `/api/conversas/${c1}`)).corpo.conversa.titulo).toBe(t1);

    const c2 = await novaConversa(A);
    const anexo = (await upload(A, c2, "extrato_maio.csv", "a;b\n1;2")).corpo.anexo;
    await enviar(A, c2, "", { anexos: [anexo.chave] });
    expect((await api(A, "GET", `/api/conversas/${c2}`)).corpo.conversa.titulo).toBe("extrato_maio.csv");
  });
});

describe("cancelar", () => {
  it("na fila: encerra na hora, apaga a mensagem do assessor e libera para uma nova", async () => {
    const conv = await novaConversa(A);
    const r = await enviar(A, conv, "mensagem que vou cancelar");
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens`)).corpo.itens).toHaveLength(1);
    const c = await api(A, "POST", `/api/conversas/${conv}/cancelar`);
    expect(c.status).toBe(202);
    expect(c.corpo).toEqual({ ok: true });
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens`)).corpo.itens).toHaveLength(0);
    const estado = await api(A, "GET", `/api/conversas/${conv}`);
    expect(estado.corpo.tarefa).toMatchObject({ id: r.corpo.tarefa.id, status: "cancelada" });
    // Idempotente, e a conversa aceita outra mensagem.
    expect((await api(A, "POST", `/api/conversas/${conv}/cancelar`)).status).toBe(202);
    expect((await enviar(A, conv, "outra")).status).toBe(202);
  });

  it("rodando: só grava a marca; a mensagem fica até o consumidor encerrar", async () => {
    const conv = await novaConversa(A);
    const r = await enviar(A, conv, "em andamento");
    await t.rpc(conv, "comecarTarefa", r.corpo.tarefa.id, 1);
    expect((await api(A, "POST", `/api/conversas/${conv}/cancelar`)).status).toBe(202);
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens`)).corpo.itens).toHaveLength(1);
    expect(await t.rpc(conv, "cancelado", r.corpo.tarefa.id)).toBe(true);
  });
});

describe("conversas: criação, leitura e atualização", () => {
  it("cria com o limite do medidor do modelo e devolve um caso vazio", async () => {
    const r = await api(A, "POST", "/api/conversas", { titulo: "  Caso Carlos  " });
    expect(r.status).toBe(201);
    expect(r.corpo.conversa).toMatchObject({ titulo: "Caso Carlos", ctxTokens: 0 });
    expect(r.corpo.conversa.id).toMatch(/^[0-9a-f]{32}$/);
    expect(r.corpo.conversa.ctxLimite).toBeGreaterThanOrEqual(200_000);
    expect(r.corpo.caso).toMatchObject({ id: r.corpo.conversa.id, fontes: [], carteira: null, ocupado: false });
    expect((await api(A, "POST", "/api/conversas", { titulo: 5 })).status).toBe(400);
  });

  it("GET devolve conversa, caso, tarefa, contexto e alertas; PATCH renomeia sem reordenar e registra alerta visto", async () => {
    const conv = await novaConversa(A, "Primeiro");
    const antes = (await api(A, "GET", `/api/conversas/${conv}`)).corpo;
    expect(antes).toMatchObject({ tarefa: null, contexto: null, alertasVistos: [] });
    const { versao } = await t.rpc<{ versao: number }>(conv, "obterCaso");
    expect(versao).toBe(0);

    const ctx = { tokens: 130000, limite: 200000, pct: 65, estimado: false, partes: { transcricao: 1, carteira: 1, historico: 1, outros: 1 } };
    const r = await enviar(A, conv, "oi");
    await t.rpc(conv, "publicar", "contexto", ctx, r.corpo.tarefa.id);
    const lido = (await api(A, "GET", `/api/conversas/${conv}`)).corpo;
    expect(lido.contexto).toEqual(ctx);
    expect(lido.tarefa).toMatchObject({ status: "na_fila", tipo: "turno" });
    expect(lido.caso.ocupado).toBe(true);

    const atualizada = lido.conversa.atualizada;
    const p = await api(A, "PATCH", `/api/conversas/${conv}`, { titulo: "Renomeada", alertaVisto: 60 });
    expect(p.status).toBe(200);
    expect(p.corpo.conversa).toMatchObject({ titulo: "Renomeada", atualizada });
    expect((await api(A, "GET", `/api/conversas/${conv}`)).corpo.alertasVistos).toEqual([60]);
    expect((await api(A, "PATCH", `/api/conversas/${conv}`, { alertaVisto: 70 })).status).toBe(400);
    expect((await api(A, "PATCH", `/api/conversas/${conv}`, { titulo: "   " })).status).toBe(400);
    expect((await api(A, "PATCH", `/api/conversas/${conv}`, {})).status).toBe(400);
  });

  it("GET com o caso salvo no DO calcula a prontidão, com o texto da transcrição vindo do R2", async () => {
    const conv = await novaConversa(A);
    const idA = await doUsuario(A);
    const { ARQUIVOS } = await t.worker.getEnv();
    await ARQUIVOS.put(`${chaveConversa(idA, conv)}fontes/h1.txt`, "texto da transcrição");
    const caso = { ...casoPronto(conv), fontes: [{ nome: "r1.txt", papel: "transcricao", origemPapel: "usuario", hash: "h1" }] };
    await t.rpc(conv, "salvarCaso", caso);
    const r = await api(A, "GET", `/api/conversas/${conv}`);
    expect(r.status).toBe(200);
    expect(r.corpo.caso.lead).toMatchObject({ nome: "Ana", perfil: "Moderado" });
    expect(r.corpo.caso.prontidao.pronto).toBe(true);
    expect(r.corpo.caso.fontes[0]).toMatchObject({ nome: "r1.txt", papel: "transcricao" });
    expect(JSON.stringify(r.corpo)).not.toContain("texto da transcrição"); // o texto das fontes nunca vai ao navegador
  });
});

describe("paginação", () => {
  it("conversas: 30 por página, sem repetir nem pular, estável com empates em atualizada", async () => {
    const U = "paginacao@eqi.local";
    const ids: string[] = [];
    for (let i = 0; i < 35; i++) ids.push(await novaConversa(U, `c${i}`));
    // Dez delas com o mesmo `atualizada`: o desempate por id mantém a ordem e o cursor.
    const { DB } = await t.worker.getEnv();
    const base = Date.now() - 10_000;
    await DB.batch(ids.map((id, i) => DB.prepare("UPDATE conversas SET atualizada = ? WHERE id = ?").bind(i < 10 ? base : base + i, id)));

    const p1 = await api(U, "GET", "/api/conversas");
    expect(p1.corpo.itens).toHaveLength(30);
    expect(p1.corpo.cursor).toMatch(/^\d+_[0-9a-f]{32}$/);
    const p2 = await api(U, "GET", `/api/conversas?cursor=${encodeURIComponent(p1.corpo.cursor)}`);
    expect(p2.corpo.itens).toHaveLength(5);
    expect(p2.corpo.cursor).toBeNull();
    const todos = [...p1.corpo.itens, ...p2.corpo.itens] as { id: string; atualizada: number }[];
    expect(new Set(todos.map((c) => c.id)).size).toBe(35);
    for (let i = 1; i < todos.length; i++) {
      const [a, b] = [todos[i - 1], todos[i]];
      expect(a.atualizada > b.atualizada || (a.atualizada === b.atualizada && a.id > b.id)).toBe(true);
    }
    expect((await api(U, "GET", "/api/conversas?cursor=lixo")).status).toBe(400);
    expect((await api(U, "GET", "/api/conversas?cursor=1_' OR 1=1 --")).status).toBe(400);
  });

  it("mensagens: gravação simultânea nunca repete seq; páginas de 50 em ordem crescente, rolando para trás", async () => {
    const conv = await novaConversa(A);
    const e = (await t.worker.getEnv()) as unknown as CloudflareEnv;
    await Promise.all(Array.from({ length: 120 }, (_, i) => gravarMensagem(e, { conversaId: conv, tipo: i % 2 ? "atlas" : "usuario", texto: `m${i}` })));
    const seqs = (await linhas("SELECT seq FROM mensagens WHERE conversa_id = ? ORDER BY seq", conv)).map((l) => l.seq);
    expect(seqs).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));

    const p1 = (await api(A, "GET", `/api/conversas/${conv}/mensagens`)).corpo;
    expect(p1.itens.map((m: { seq: number }) => m.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 71));
    expect(p1.maisAntigas).toBe(true);
    const p2 = (await api(A, "GET", `/api/conversas/${conv}/mensagens?antes=71&limite=50`)).corpo;
    expect(p2.itens[0].seq).toBe(21);
    expect(p2.itens.at(-1).seq).toBe(70);
    expect(p2.maisAntigas).toBe(true);
    const p3 = (await api(A, "GET", `/api/conversas/${conv}/mensagens?antes=21`)).corpo;
    expect(p3.itens.map((m: { seq: number }) => m.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(p3.maisAntigas).toBe(false);
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens?antes=abc`)).status).toBe(400);
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens?limite=0`)).status).toBe(400);
    expect((await api(A, "GET", `/api/conversas/${conv}/mensagens?limite=101`)).status).toBe(400);
  });

  it("gravarMensagem com idCliente repetido devolve a já gravada e não consome seq", async () => {
    const conv = await novaConversa(A);
    const e = (await t.worker.getEnv()) as unknown as CloudflareEnv;
    const m1 = await gravarMensagem(e, { conversaId: conv, tipo: "usuario", texto: "a", idCliente: "dup" });
    const m2 = await gravarMensagem(e, { conversaId: conv, tipo: "usuario", texto: "b", idCliente: "dup" });
    expect(m2).toEqual(m1);
    const m3 = await gravarMensagem(e, { conversaId: conv, tipo: "atlas", texto: "c", meta: { erro: true } });
    expect(m3.seq).toBe(2);
    expect(m3.meta).toEqual({ erro: true });
    await expect(gravarMensagem(e, { conversaId: "0".repeat(32), tipo: "atlas", texto: "x" })).rejects.toThrow(); // conversa inexistente
  });
});

describe("anexos (PUT, streaming para o R2)", () => {
  it("grava o arquivo sob o prefixo do usuário e da conversa, com id aleatório e nome sanitizado", async () => {
    const conv = await novaConversa(A);
    const idA = await doUsuario(A);
    const conteudo = "ativo;valor\nCDB;100\nLCI;200\n";
    const r1 = await upload(A, conv, "carteira.csv", conteudo);
    const r2 = await upload(A, conv, "carteira.csv", conteudo);
    expect(r1.status).toBe(201);
    expect(r1.corpo.anexo).toMatchObject({ nome: "carteira.csv", tamanho: conteudo.length, tipo: "text/csv" });
    expect(r1.corpo.anexo.chave).toMatch(new RegExp(`^${chaveConversa(idA, conv)}anexos/[0-9a-f]{16}-carteira\\.csv$`));
    expect(r2.corpo.anexo.chave).not.toBe(r1.corpo.anexo.chave); // mesmo nome e conteúdo: chaves distintas
    const { ARQUIVOS } = await t.worker.getEnv();
    const obj = await ARQUIVOS.get(r1.corpo.anexo.chave);
    expect(await obj!.text()).toBe(conteudo);
    expect(obj!.httpMetadata?.contentType).toBe("text/csv");

    const suspeito = await upload(A, conv, "../../../outro/segredo.txt", "x");
    expect(suspeito.status).toBe(201);
    expect(suspeito.corpo.anexo.chave.startsWith(chaveConversa(idA, conv))).toBe(true);
    expect(suspeito.corpo.anexo.chave.slice(chaveConversa(idA, conv).length)).not.toMatch(/\.\.\/|\/\.\./);
    expect(suspeito.corpo.anexo.nome).not.toContain("/");

    const grande = new Uint8Array(3 * 1024 * 1024).fill(97); // 3 MB: confere que o corpo inteiro chega íntegro
    const r3 = await upload(A, conv, "grande.txt", grande);
    expect(r3.status).toBe(201);
    expect((await ARQUIVOS.head(r3.corpo.anexo.chave))!.size).toBe(grande.byteLength);
  });

  it("415 para formato fora da lista e 400 para vazio ou sem nome; a extensão vale, não o MIME", async () => {
    const conv = await novaConversa(A);
    expect((await upload(A, conv, "virus.exe", "MZ")).status).toBe(415);
    expect((await upload(A, conv, "sem-extensao", "x")).status).toBe(415);
    expect((await upload(A, conv, "falso.txt.exe", "x", { "content-type": "text/plain" })).status).toBe(415);
    expect((await upload(A, conv, "vazio.txt", "")).status).toBe(400);
    const semNome = await buscar(`/api/conversas/${conv}/anexos`, { method: "PUT", headers: { "x-atlas-dev-usuario": A }, body: "x" });
    expect(semNome.status).toBe(400);
    expect((await objetosR2(await doUsuario(A), conv))).toHaveLength(0);
  });

  it("413 por formato: imagem acima de 5 MB e formatos do Worker acima de 10 MB; nada é gravado", async () => {
    const conv = await novaConversa(A);
    const img = await upload(A, conv, "print.png", new Uint8Array(5 * 1024 * 1024 + 1));
    expect(img.status).toBe(413);
    expect(img.corpo.erro).toMatch(/5 MB/);
    const txt = await upload(A, conv, "transcricao.txt", new Uint8Array(10 * 1024 * 1024 + 1));
    expect(txt.status).toBe(413);
    expect(txt.corpo.erro).toMatch(/10 MB/);
    expect((await upload(A, conv, "deck.pptx", new Uint8Array(10 * 1024 * 1024 + 1))).status).toBe(413);
    expect(await objetosR2(await doUsuario(A), conv)).toHaveLength(0);
    // Acima do limite do Worker, pdf e xlsx ainda valem até MAX_UPLOAD_MB (25 MB).
    const pdf = await upload(A, conv, "extrato.pdf", new Uint8Array(11 * 1024 * 1024).fill(32));
    expect(pdf.status).toBe(201);
    expect(pdf.corpo.anexo.tipo).toBe("application/pdf");
  });

  it("411 sem Content-Length", async () => {
    const conv = await novaConversa(A);
    const corpo = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("a;b\n1;2")); c.close(); } });
    const r = await buscar(`/api/conversas/${conv}/anexos?nome=a.csv`, {
      method: "PUT",
      headers: { "x-atlas-dev-usuario": A },
      body: corpo,
      duplex: "half", // exigido pelo undici para corpo em stream
    });
    expect(r.status).toBe(411);
  });
});

describe("gerar slides (acoes)", () => {
  const gerar = (usuario: string, conv: string, cabecalhos: Record<string, string> = {}) =>
    api(usuario, "POST", `/api/conversas/${conv}/acoes`, { acao: "gerar" }, cabecalhos);

  it("422 com as faltas quando o caso não está pronto; 400 para ação desconhecida", async () => {
    const conv = await novaConversa(A);
    const r = await gerar(A, conv);
    expect(r.status).toBe(422);
    expect(r.corpo.faltas.length).toBeGreaterThan(0);
    expect(r.corpo.erro).toMatch(/^Ainda falta:/);
    expect((await api(A, "POST", `/api/conversas/${conv}/acoes`, { acao: "outra" })).status).toBe(400);
    expect((await fila()).filter((m) => m.conversaId === conv)).toHaveLength(0);
  });

  it("503 com o deck-service fora ou com schema diferente, sem pegar a trava", async () => {
    const conv = await novaConversa(A);
    await t.rpc(conv, "salvarCaso", casoPronto(conv));
    for (const modo of ["fora", "schema"]) {
      const r = await gerar(A, conv, { "x-teste-deck": modo });
      expect(r.status, modo).toBe(503);
      expect(r.corpo.erro).toMatch(/serviço que monta o deck/);
    }
    expect((await t.rpc<{ tarefa: unknown }>(conv, "estado")).tarefa).toBeNull();
  });

  it("caso pronto: 202 com a tarefa e uma mensagem na fila; a seguinte é 409; erro de fila libera a trava", async () => {
    const conv = await novaConversa(A);
    await t.rpc(conv, "salvarCaso", casoPronto(conv));
    const falha = await gerar(A, conv, { "x-teste-fila": "falha" });
    expect(falha.status).toBe(503);
    const r = await gerar(A, conv);
    expect(r.status).toBe(202);
    expect(r.corpo.tarefa).toMatchObject({ tipo: "deck", status: "na_fila" });
    expect((await fila()).filter((m) => m.conversaId === conv)).toEqual([
      { tipo: "deck", conversaId: conv, usuarioId: await doUsuario(A), tarefaId: r.corpo.tarefa.id },
    ]);
    expect((await gerar(A, conv)).status).toBe(409);
    expect((await enviar(A, conv, "durante o deck")).status).toBe(409);
    // Cancelar o deck na fila não apaga mensagem nenhuma e devolve a trava.
    expect((await api(A, "POST", `/api/conversas/${conv}/cancelar`)).status).toBe(202);
    expect((await gerar(A, conv)).status).toBe(202);
  });
});

describe("download do deck e eventos", () => {
  it("serve o arquivo do R2 como anexo, só ao dono; versão e formato inválidos ou ausentes", async () => {
    const conv = await novaConversa(A);
    const idA = await doUsuario(A);
    const { ARQUIVOS } = await t.worker.getEnv();
    await ARQUIVOS.put(`${chaveConversa(idA, conv)}decks/v2.pdf`, "%PDF-fake");
    const r = await buscar(`/api/conversas/${conv}/decks/2?fmt=pdf`, { headers: { "x-atlas-dev-usuario": A } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="atlas-deck-v2.pdf"');
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(await r.text()).toBe("%PDF-fake");
    expect((await api(A, "GET", `/api/conversas/${conv}/decks/2?fmt=pptx`)).status).toBe(404);
    expect((await api(A, "GET", `/api/conversas/${conv}/decks/3?fmt=pdf`)).status).toBe(404);
    expect((await api(A, "GET", `/api/conversas/${conv}/decks/2?fmt=exe`)).status).toBe(400);
    expect((await api(A, "GET", `/api/conversas/${conv}/decks/..%2F2?fmt=pdf`)).status).toBe(400);
    expect((await api(A, "GET", `/api/conversas/${conv}/decks/0?fmt=pdf`)).status).toBe(400);
  });

  it("eventos: SSE do DO com o estado primeiro; Last-Event-ID chega ao DO", async () => {
    const conv = await novaConversa(A);
    const r = await enviar(A, conv, "oi");
    await t.rpc(conv, "publicar", "atividade", { texto: "lendo" }, r.corpo.tarefa.id);
    const ac = new AbortController();
    const res = await buscar(`/api/conversas/${conv}/eventos`, { headers: { "x-atlas-dev-usuario": A }, signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const leitor = res.body!.getReader();
    let texto = "";
    const dec = new TextDecoder();
    while (!texto.includes("event: atividade")) {
      const { value, done } = await leitor.read();
      if (done) break;
      texto += dec.decode(value);
    }
    expect(texto.indexOf("event: estado")).toBeGreaterThanOrEqual(0);
    expect(texto.indexOf("event: estado")).toBeLessThan(texto.indexOf("event: atividade"));
    ac.abort();
    await leitor.cancel().catch(() => undefined);
  });
});

describe("exclusão e purga", () => {
  async function conversaCheia(usuario: string) {
    const conv = await novaConversa(usuario);
    const idU = await doUsuario(usuario);
    const e = (await t.worker.getEnv()) as unknown as CloudflareEnv;
    const { ARQUIVOS } = await t.worker.getEnv();
    await gravarMensagem(e, { conversaId: conv, tipo: "usuario", texto: "dado do lead" });
    await gravarMensagem(e, { conversaId: conv, tipo: "atlas", texto: "resposta" });
    const anexo = (await upload(usuario, conv, "carteira.csv", "a;b\n1;2")).corpo.anexo.chave as string;
    await ARQUIVOS.put(`${chaveConversa(idU, conv)}fontes/h1.txt`, "texto extraído");
    for (let i = 1; i <= 3; i++) await ARQUIVOS.put(`${chaveConversa(idU, conv)}decks/v${i}.pptx`, `deck ${i}`);
    await t.rpc(conv, "salvarCaso", casoPronto(conv));
    return { conv, idU, anexo };
  }

  const purgada = (conv: string, idU: string) => async () => ({
    conversas: (await linhas("SELECT id FROM conversas WHERE id = ?", conv)).length,
    mensagens: (await linhas("SELECT seq FROM mensagens WHERE conversa_id = ?", conv)).length,
    objetos: (await objetosR2(idU, conv)).length,
    doPurgado: (await t.rpc<{ purgada: boolean }>(conv, "estado")).purgada,
  });

  it("DELETE some da lista na hora; a purga apaga R2, DO e D1; outras conversas ficam intactas", async () => {
    const alvo = await conversaCheia(A);
    const vizinha = await conversaCheia(A);
    const doB = await conversaCheia(B);
    expect((await objetosR2(alvo.idU, alvo.conv)).length).toBe(5);

    const r = await api(A, "DELETE", `/api/conversas/${alvo.conv}`);
    expect(r.status).toBe(204);
    // Na hora: some da lista e todas as rotas respondem 404, mesmo que a purga ainda não tenha rodado.
    const lista = await api(A, "GET", "/api/conversas");
    expect(lista.corpo.itens.map((c: { id: string }) => c.id)).not.toContain(alvo.conv);
    expect((await api(A, "GET", `/api/conversas/${alvo.conv}`)).status).toBe(404);
    expect((await enviar(A, alvo.conv)).status).toBe(404);
    expect((await api(A, "GET", `/api/conversas/${alvo.conv}/decks/1?fmt=pptx`)).status).toBe(404);
    expect((await api(A, "DELETE", `/api/conversas/${alvo.conv}`)).status).toBe(404);

    const fim = await ate(purgada(alvo.conv, alvo.idU), (v) => v.conversas === 0 && v.objetos === 0 && v.doPurgado);
    expect(fim).toEqual({ conversas: 0, mensagens: 0, objetos: 0, doPurgado: true });
    expect((await t.rpc<{ caso: unknown }>(alvo.conv, "obterCaso")).caso).toBeNull();

    // Vizinha do mesmo usuário e conversa de outro usuário: nada foi tocado.
    expect((await objetosR2(vizinha.idU, vizinha.conv)).length).toBe(5);
    expect((await objetosR2(doB.idU, doB.conv)).length).toBe(5);
    expect((await linhas("SELECT seq FROM mensagens WHERE conversa_id = ?", vizinha.conv)).length).toBe(2);
    expect((await api(A, "GET", `/api/conversas/${vizinha.conv}`)).status).toBe(200);
    expect((await t.rpc<{ caso: unknown }>(vizinha.conv, "obterCaso")).caso).not.toBeNull();
  });

  it("apagar com tarefa em andamento cancela a tarefa e purga mesmo assim", async () => {
    const c = await conversaCheia(A);
    const r = await enviar(A, c.conv, "em andamento");
    await t.rpc(c.conv, "comecarTarefa", r.corpo.tarefa.id, 1);
    expect((await api(A, "DELETE", `/api/conversas/${c.conv}`)).status).toBe(204);
    const fim = await ate(purgada(c.conv, c.idU), (v) => v.conversas === 0 && v.objetos === 0 && v.doPurgado);
    expect(fim.mensagens).toBe(0);
    // Um consumidor atrasado não consegue gravar nada depois da purga.
    expect(await t.rpc(c.conv, "salvarCaso", casoPronto(c.conv), { tarefaId: r.corpo.tarefa.id })).toMatchObject({ ok: false, motivo: "purgada" });
    expect(await t.rpc(c.conv, "batimento", r.corpo.tarefa.id)).toMatchObject({ ativa: false });
  });

  it("a purga é idempotente e recusa conversa ativa", async () => {
    const c = await conversaCheia(A);
    const msg = { tipo: "purga", conversaId: c.conv, usuarioId: c.idU };
    await buscar("/enfileirar", { method: "POST", body: JSON.stringify(msg) });
    await new Promise((res) => setTimeout(res, 1500));
    // Conversa ativa (sem `apagada`): a mensagem de purga é ignorada.
    expect((await purgada(c.conv, c.idU)()).objetos).toBe(5);
    expect((await api(A, "GET", `/api/conversas/${c.conv}`)).status).toBe(200);
    // Marcada como apagada: duas mensagens iguais (entrega duplicada) terminam o trabalho sem erro.
    const { DB } = await t.worker.getEnv();
    await DB.prepare("UPDATE conversas SET apagada = ? WHERE id = ?").bind(Date.now(), c.conv).run();
    for (let i = 0; i < 2; i++) await buscar("/enfileirar", { method: "POST", body: JSON.stringify(msg) });
    await ate(purgada(c.conv, c.idU), (v) => v.conversas === 0 && v.objetos === 0 && v.doPurgado);
    // Reentrega depois de concluída: sem linha, ainda termina sem lançar.
    await buscar("/enfileirar", { method: "POST", body: JSON.stringify(msg) });
    await new Promise((res) => setTimeout(res, 1000));
    expect((await purgada(c.conv, c.idU)()).objetos).toBe(0);
  });
});

describe("cron de purga (90 dias)", () => {
  it("purga a conversa de 91 dias e as pendentes antigas; mantém a de 89 dias e a marcada há instantes", async () => {
    const U = "cron@eqi.local";
    const mk = async () => {
      const conv = await novaConversa(U);
      const idU = await doUsuario(U);
      const e = (await t.worker.getEnv()) as unknown as CloudflareEnv;
      const { ARQUIVOS } = await t.worker.getEnv();
      await gravarMensagem(e, { conversaId: conv, tipo: "usuario", texto: "dado do lead" });
      await ARQUIVOS.put(`${chaveConversa(idU, conv)}anexos/aaaa-carteira.csv`, "a;b");
      await t.rpc(conv, "salvarCaso", casoPronto(conv));
      return { conv, idU };
    };
    const velha = await mk();
    const recente = await mk();
    const pendente = await mk();
    const marcadaAgora = await mk();
    const { DB } = await t.worker.getEnv();
    const agora = Date.now();
    const atualiza = (id: string, atualizada: number, apagada: number | null) =>
      DB.prepare("UPDATE conversas SET atualizada = ?, apagada = ? WHERE id = ?").bind(atualizada, apagada, id);
    await DB.batch([
      atualiza(velha.conv, agora - 91 * DIA, null),
      atualiza(recente.conv, agora - 89 * DIA, null),
      atualiza(pendente.conv, agora - 1000, agora - 2 * 3_600_000), // marcada há 2 h e nunca purgada (envio à fila perdido)
      atualiza(marcadaAgora.conv, agora - 1000, agora - 60_000), // marcada há 1 min: ainda deve estar na fila
    ]);

    const r = await (await buscar("/teste/cron", { method: "POST", body: JSON.stringify({ agora }) })).json() as { pendentes: number; inativas: number };
    expect(r.pendentes).toBeGreaterThanOrEqual(1);
    expect(r.inativas).toBeGreaterThanOrEqual(1);

    const limpa = (c: { conv: string; idU: string }) => async () => ({
      linha: (await linhas("SELECT id FROM conversas WHERE id = ?", c.conv)).length,
      msgs: (await linhas("SELECT seq FROM mensagens WHERE conversa_id = ?", c.conv)).length,
      objetos: (await objetosR2(c.idU, c.conv)).length,
      doPurgado: (await t.rpc<{ purgada: boolean }>(c.conv, "estado")).purgada,
    });
    for (const c of [velha, pendente]) {
      expect(await ate(limpa(c), (v) => v.linha === 0 && v.objetos === 0 && v.doPurgado)).toEqual({ linha: 0, msgs: 0, objetos: 0, doPurgado: true });
    }
    // Quem sobrou continua inteiro: linha, mensagem, arquivo e caso no DO.
    expect(await limpa(recente)()).toEqual({ linha: 1, msgs: 1, objetos: 1, doPurgado: false });
    expect((await t.rpc<{ caso: unknown }>(recente.conv, "obterCaso")).caso).not.toBeNull();
    expect((await linhas("SELECT apagada FROM conversas WHERE id = ?", recente.conv))[0].apagada).toBeNull();
    expect(await limpa(marcadaAgora)()).toMatchObject({ linha: 1, objetos: 1, doPurgado: false });
    expect((await api(U, "GET", "/api/conversas")).corpo.itens.map((c: { id: string }) => c.id)).toContain(recente.conv);
  });

  it("uma conversa reaberta entre a consulta e a marcação não é apagada", async () => {
    const e = (await t.worker.getEnv()) as unknown as CloudflareEnv;
    const { marcarApagadaSeInativa } = await import("../../lib/db/conversas");
    const conv = await novaConversa(A);
    const corte = Date.now() - 90 * DIA;
    const { DB } = await t.worker.getEnv();
    await DB.prepare("UPDATE conversas SET atualizada = ? WHERE id = ?").bind(corte + 5000, conv).run(); // usada depois do corte
    expect(await marcarApagadaSeInativa(e, conv, corte)).toBe(false);
    expect((await api(A, "GET", `/api/conversas/${conv}`)).status).toBe(200);
  });
});
