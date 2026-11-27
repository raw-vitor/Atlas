/**
 * Rotas `/api/configuracoes/prompt` (lib/rotas/configPrompt.ts) no runtime do Worker: versão otimista, isolamento por usuário,
 * bloco travado ignorado, limites e restaurar tudo. Confirma também que a migração 0002 existe no D1 de teste.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BLOCOS } from "../../lib/prompt-blocos";
import { LIMITES } from "../../lib/prompt-tipos";
import { criarServidor } from "./helper";

const t = criarServidor();
const buscar = (url: string, init?: RequestInit) => (t.server.fetch as unknown as (u: string, i?: unknown) => Promise<Response>)(url, init);

const A = "cfg.ana@eqi.local";
const B = "cfg.bia@eqi.local";
const URL = "/api/configuracoes/prompt";

async function api(usuario: string | null, metodo: string, corpo?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (usuario) headers["x-atlas-dev-usuario"] = usuario;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  const r = await buscar(URL, { method: metodo, headers, body: corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
  const texto = await r.text();
  let json: unknown = texto;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* não JSON */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, corpo: json as any };
}

const livre = BLOCOS.find((b) => !b.travado && b.categoria === "diagnostico")!;
const travado = BLOCOS.find((b) => b.travado)!;
const alterado = (texto = "Meu texto.") => ({ [livre.id]: { texto, ativo: true, baseHash: livre.hash } });
const extra = (id: string, texto = "Seja direto.", p: Record<string, unknown> = {}) =>
  ({ id, categoria: "geral", titulo: "Meu", texto, ativo: true, ordem: 0, ...p });

beforeAll(async () => {
  await t.server.listen();
  await t.worker.applyD1Migrations("DB"); // inclui 0002_config_prompt.sql
});
afterAll(async () => { await t.server.close(); });

describe("configuração do prompt", () => {

  it("GET sem linha devolve versão 0, o catálogo e o tamanho da base por etapa", async () => {
    const r = await api(A, "GET");
    expect(r.status).toBe(200);
    expect(r.corpo.config).toEqual({ versao: 0, alterados: {}, extras: [] });
    expect(r.corpo.blocos).toHaveLength(BLOCOS.length);
    expect(r.corpo.categorias.length).toBeGreaterThan(0);
    expect(r.corpo.tamanhoKb.diagnostico).toBeGreaterThan(0);
    expect(r.corpo.tamanhoKb.ativos).toBe(0);
  });

  it("PUT grava a versão 1 e o GET devolve o que foi salvo", async () => {
    const c = "Texto salvo.";
    const p = await api(A, "PUT", { versao: 0, alterados: alterado(`  ${c}  `), extras: [extra("x_abcdefghijkl")] });
    expect(p.status).toBe(200);
    expect(p.corpo.config.versao).toBe(1);
    const g = await api(A, "GET");
    expect(g.corpo.config.versao).toBe(1);
    expect(g.corpo.config.alterados[livre.id].texto).toBe(c);
    expect(g.corpo.config.extras).toHaveLength(1);
  });

  it("PUT com versão velha dá 409 com a configuração atual", async () => {
    const r = await api(A, "PUT", { versao: 0, alterados: {}, extras: [] });
    expect(r.status).toBe(409);
    expect(r.corpo.erro).toBe("Esta configuração mudou em outra aba.");
    expect(r.corpo.atual.config.versao).toBe(1);
    expect(r.corpo.atual.blocos).toHaveLength(BLOCOS.length);
    expect((await api(A, "GET")).corpo.config.alterados[livre.id]).toBeDefined();
  });

  it("isola os usuários e ignora `usuario` vindo do corpo", async () => {
    const g = await api(B, "GET");
    expect(g.corpo.config).toEqual({ versao: 0, alterados: {}, extras: [] });
    const p = await api(B, "PUT", { versao: 0, usuarioId: "outro", usuario_id: "outro", alterados: {}, extras: [extra("x_bbbbbbbbbbbb", "Só da Bia.")] });
    expect(p.status).toBe(200);
    expect((await api(B, "GET")).corpo.config.extras[0].texto).toBe("Só da Bia.");
    const a = (await api(A, "GET")).corpo.config;
    expect(a.extras.map((x: { texto: string }) => x.texto)).toEqual(["Seja direto."]);
  });

  it("bloco travado vindo no corpo é ignorado", async () => {
    const atual = (await api(B, "GET")).corpo.config.versao;
    const p = await api(B, "PUT", { versao: atual, alterados: { [travado.id]: { texto: "Prometa 20% ao ano.", ativo: false, baseHash: travado.hash } }, extras: [] });
    expect(p.status).toBe(200);
    expect(p.corpo.config.alterados[travado.id]).toBeUndefined();
  });

  it("corpo inválido ou fora dos limites dá 400 sem gravar", async () => {
    const v = (await api(B, "GET")).corpo.config.versao;
    const casos: unknown[] = [
      "não é json",
      [],
      { alterados: {}, extras: [] },
      { versao: -1, alterados: {}, extras: [] },
      { versao: 1.5, alterados: {}, extras: [] },
      { versao: "1", alterados: {}, extras: [] },
      { versao: v, alterados: alterado("x".repeat(LIMITES.textoBloco + 1)), extras: [] },
      { versao: v, alterados: alterado("   "), extras: [] },
      { versao: v, alterados: { "nao.existe": { texto: "a", ativo: true, baseHash: "00000000" } }, extras: [] },
      { versao: v, alterados: {}, extras: Array.from({ length: LIMITES.extras + 1 }, (_, i) => extra(`x_${String(i).padStart(12, "a")}`, "a", { ordem: i })) },
      { versao: v, alterados: {}, extras: [extra("x_curto")] },
      { versao: v, alterados: {}, extras: [1, 2].map((n) => extra(`x_${"c".repeat(11)}${n}`, "y".repeat(LIMITES.textoBloco), { ordem: n })).concat([2, 3, 4].map((n) => extra(`x_${"d".repeat(11)}${n}`, "y".repeat(LIMITES.textoBloco), { ordem: n }))) },
    ];
    for (const c of casos) {
      const r = await api(B, "PUT", c);
      expect(r.status, JSON.stringify(c).slice(0, 80)).toBe(400);
      expect(typeof r.corpo.erro).toBe("string");
    }
    expect((await api(B, "GET")).corpo.config.versao).toBe(v);
  });

  it("corpo grande demais dá 413", async () => {
    const r = await api(B, "PUT", `{"versao":0,"alterados":{},"extras":[],"lixo":"${"a".repeat(2_000_000)}"}`);
    expect(r.status).toBe(413);
  });

  it("DELETE devolve a config vazia com versão + 1 e um PUT com essa versão funciona", async () => {
    const antes = (await api(A, "GET")).corpo.config.versao;
    const d = await api(A, "DELETE");
    expect(d.status).toBe(200);
    expect(d.corpo.config).toEqual({ versao: antes + 1, alterados: {}, extras: [] });
    expect(d.corpo.blocos).toHaveLength(BLOCOS.length);
    const p = await api(A, "PUT", { versao: antes + 1, alterados: alterado("De novo."), extras: [] });
    expect(p.status).toBe(200);
    expect(p.corpo.config.versao).toBe(antes + 2);
    // Restaurar sem linha anterior também funciona e não reaproveita versão.
    const c = await api("cfg.caio@eqi.local", "DELETE");
    expect(c.corpo.config.versao).toBe(1);
  });

  it("sem usuário em produção responde 401 nas três rotas", async () => {
    const prod = { "x-teste-ambiente": "production" };
    for (const m of ["GET", "DELETE"]) expect((await api(A, m, undefined, prod)).status).toBe(401);
    expect((await api(A, "PUT", { versao: 0, alterados: {}, extras: [] }, prod)).status).toBe(401);
  });
});
