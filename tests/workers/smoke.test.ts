import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarServidor, novoId } from "./helper";

const t = criarServidor();

beforeAll(async () => {
  await t.server.listen();
  await t.worker.applyD1Migrations("DB");
});
afterAll(async () => {
  await t.server.close();
});

describe("plataforma local (wrangler/Miniflare)", () => {
  it("D1: a migração 0001 criou as tabelas e os índices", async () => {
    const env = await t.worker.getEnv();
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>();
    const nomes = results.map((r) => r.name);
    for (const n of ["usuarios", "conversas", "mensagens", "conversas_usuario", "conversas_purga", "mensagens_id_cliente"]) expect(nomes).toContain(n);
  });

  it("D1: apagar a conversa apaga as mensagens (ON DELETE CASCADE) e idCliente repetido é recusado", async () => {
    const { DB } = await t.worker.getEnv();
    await DB.prepare("INSERT INTO usuarios (id, email, criado) VALUES ('u1', 'u1@eqi.local', 1)").run();
    await DB.prepare("INSERT INTO conversas (id, usuario_id, criada, atualizada, ctx_limite) VALUES ('c1', 'u1', 1, 1, 200000)").run();
    const ins = (seq: number, id: string, idCliente: string | null) =>
      DB.prepare("INSERT INTO mensagens (conversa_id, seq, id, id_cliente, tipo, texto, criada) VALUES ('c1', ?, ?, ?, 'usuario', 'oi', 1)").bind(seq, id, idCliente).run();
    await ins(1, "m1", "cli-1");
    await expect(ins(2, "m2", "cli-1")).rejects.toThrow(); // reenvio do mesmo POST
    await ins(3, "m3", null);
    await ins(4, "m4", null); // sem idCliente (mensagens do Atlas) pode repetir
    await DB.prepare("DELETE FROM conversas WHERE id = 'c1'").run();
    const { n } = (await DB.prepare("SELECT COUNT(*) AS n FROM mensagens").first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it("R2: put, get, list por prefixo e delete", async () => {
    const { ARQUIVOS } = await t.worker.getEnv();
    await ARQUIVOS.put("u/u1/c/c1/anexos/aaa-carteira.csv", "ativo;valor\nCDB;10");
    await ARQUIVOS.put("u/u1/c/c2/anexos/bbb.txt", "outra conversa");
    const obj = await ARQUIVOS.get("u/u1/c/c1/anexos/aaa-carteira.csv");
    expect(await obj!.text()).toBe("ativo;valor\nCDB;10");
    const lista = await ARQUIVOS.list({ prefix: "u/u1/c/c1/" });
    expect(lista.objects.map((o) => o.key)).toEqual(["u/u1/c/c1/anexos/aaa-carteira.csv"]);
    await ARQUIVOS.delete(lista.objects.map((o) => o.key));
    expect(await ARQUIVOS.get("u/u1/c/c1/anexos/aaa-carteira.csv")).toBeNull();
    expect(await ARQUIVOS.get("u/u1/c/c2/anexos/bbb.txt")).not.toBeNull(); // outra conversa intacta
  });

  it("DO: RPC simples e estado durável (sobrevive a despejar a instância da memória)", async () => {
    const id = novoId();
    expect(await t.rpc(id, "obterCaso")).toEqual({ caso: null, versao: 0 });
    expect(await t.rpc(id, "salvarCaso", { lead: { nome: "Fulano" } })).toEqual({ ok: true, versao: 1 });
    await t.evictar(id);
    expect(await t.rpc(id, "obterCaso")).toEqual({ caso: { lead: { nome: "Fulano" } }, versao: 1 });
  });

  it("Fila: o consumidor do Worker recebe a mensagem de purga, executa e dá ack", async () => {
    t.server.clearLogs();
    const r = await t.server.fetch("/enfileirar", {
      method: "POST",
      body: JSON.stringify({ tipo: "purga", conversaId: "c-fila", usuarioId: "u1" }),
    });
    expect(r.ok).toBe(true);
    const fim = Date.now() + 15000;
    const viu = () => t.server.getLogs().some((l) => String(l.message).includes("purga concluída"));
    while (!viu() && Date.now() < fim) await new Promise((res) => setTimeout(res, 100));
    expect(viu()).toBe(true);
    // Sem conteúdo do lead no log: só tipo e ids.
    const log = JSON.stringify(t.server.getLogs());
    expect(log).not.toMatch(/u1@eqi/);
    expect(log).not.toContain("[tarefa] falhou"); // ack, sem reentrega
  });
});
