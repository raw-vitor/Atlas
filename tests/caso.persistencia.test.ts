/** Persistência do caso: o DO guarda o JSON sem o texto das fontes; o texto vai para o R2, por hash, só uma vez. */
import { describe, expect, it } from "vitest";
import { casoAvulso, hashTexto, hidratarFontes, novoCaso, obterCaso, salvarCaso, type Caso } from "../lib/caso";
import { chaveFonte } from "../lib/r2";

/** DO e R2 de mentira: o que importa é o que `salvarCaso` entrega a cada um. */
function ambiente() {
  const objetos = new Map<string, string>();
  const puts: string[] = [];
  const gets: string[] = [];
  let doCaso: unknown = null, versao = 0;
  const salvas: { caso: Record<string, unknown>; opcoes: unknown }[] = [];
  const stub = {
    async obterCaso() { return { caso: doCaso === null ? null : structuredClone(doCaso), versao }; },
    async salvarCaso(caso: unknown, opcoes: { versao?: number }) {
      if (opcoes.versao !== undefined && opcoes.versao !== versao) return { ok: false, motivo: "versao", versao };
      salvas.push({ caso: JSON.parse(JSON.stringify(caso)), opcoes });
      doCaso = JSON.parse(JSON.stringify(caso));
      return { ok: true, versao: ++versao };
    },
  };
  const env = {
    CONVERSA: { idFromName: (n: string) => n, get: () => stub },
    ARQUIVOS: {
      async put(k: string, v: string) { puts.push(k); objetos.set(k, v); },
      async get(k: string) { gets.push(k); const v = objetos.get(k); return v === undefined ? null : { text: async () => v }; },
    },
  } as unknown as CloudflareEnv;
  return { env, objetos, puts, gets, salvas };
}

const fonte = (nome: string, papel: "carteira" | "transcricao" | "contexto", texto: string) =>
  ({ nome, papel, origemPapel: "automatico", texto, hash: hashTexto(texto) });
const CONV = "a".repeat(32);

describe("persistência do caso", () => {
  it("conversa sem caso: devolve um caso vazio com o id da conversa e versão 0", async () => {
    const { env } = ambiente();
    const { caso, versao } = await obterCaso(env, CONV);
    expect(versao).toBe(0);
    expect(caso).toMatchObject({ id: CONV, fontes: [], decks: [], historico: [] });
    expect("ocupado" in caso).toBe(false);
  });

  it("salvar tira o texto das fontes do JSON e o sobe ao R2 por hash; carregar devolve as fontes sem texto", async () => {
    const a = ambiente();
    const caso: Caso = novoCaso(CONV);
    caso.fontes.push(fonte("r1.txt", "transcricao", "Lead: preciso de dez mil por mês"), fonte("c.csv", "carteira", "CDB;10"));
    caso.assessor = "Luiz";
    expect(await salvarCaso(a.env, "u1", CONV, caso, { versao: 0, tarefaId: "t1" })).toEqual({ ok: true, versao: 1 });
    expect(a.salvas[0].opcoes).toEqual({ versao: 0, tarefaId: "t1" });
    expect(a.salvas[0].caso.fontes).toEqual([
      { nome: "r1.txt", papel: "transcricao", origemPapel: "automatico", hash: hashTexto("Lead: preciso de dez mil por mês") },
      { nome: "c.csv", papel: "carteira", origemPapel: "automatico", hash: hashTexto("CDB;10") }]);
    expect(JSON.stringify(a.salvas[0].caso)).not.toContain("preciso de dez mil");
    expect(a.objetos.get(chaveFonte("u1", CONV, hashTexto("CDB;10")))).toBe("CDB;10");
    expect(caso.fontes[0].texto).toBe("Lead: preciso de dez mil por mês"); // o caso em memória não perde o texto

    const { caso: lido, versao } = await obterCaso(a.env, CONV);
    expect(versao).toBe(1);
    expect(lido.assessor).toBe("Luiz");
    expect(lido.fontes.map((f) => f.texto)).toEqual(["", ""]);
  });

  it("hidratar traz só o que a seleção pede, e salvar de novo não repete o upload do que já está no R2", async () => {
    const a = ambiente();
    const caso = novoCaso(CONV);
    caso.fontes.push(fonte("r1.txt", "transcricao", "fala do lead"), fonte("c.csv", "carteira", "CDB;10"), fonte("d.txt", "contexto", "deck anterior"));
    await salvarCaso(a.env, "u1", CONV, caso);
    a.puts.length = 0;

    const { caso: lido, versao } = await obterCaso(a.env, CONV);
    await hidratarFontes(a.env, "u1", CONV, lido, ["transcricao"]);
    expect(lido.fontes.map((f) => f.texto)).toEqual(["fala do lead", "", ""]);
    await hidratarFontes(a.env, "u1", CONV, lido, (f) => f.papel !== "carteira");
    expect(lido.fontes.map((f) => f.texto)).toEqual(["fala do lead", "", "deck anterior"]);
    expect(a.gets).toHaveLength(2); // a transcrição não foi lida duas vezes: uma leitura por fonte

    lido.fontes.push(fonte("nova.txt", "transcricao", "outra reunião"));
    expect(await salvarCaso(a.env, "u1", CONV, lido, { versao })).toEqual({ ok: true, versao: 2 });
    expect(a.puts).toEqual([chaveFonte("u1", CONV, hashTexto("outra reunião"))]); // só a fonte nova sobe; a carteira (texto vazio) não é apagada
    expect(a.objetos.get(chaveFonte("u1", CONV, hashTexto("CDB;10")))).toBe("CDB;10");
    expect(a.salvas[1].caso.fontes).toHaveLength(4);
  });

  it("texto que sumiu do R2 não vira texto vazio: lança com o nome do arquivo", async () => {
    const a = ambiente();
    const caso = novoCaso(CONV);
    caso.fontes.push(fonte("r1.txt", "transcricao", "fala do lead"));
    await salvarCaso(a.env, "u1", CONV, caso);
    a.objetos.clear();
    const { caso: lido } = await obterCaso(a.env, CONV);
    await expect(hidratarFontes(a.env, "u1", CONV, lido)).rejects.toThrow('Não encontrei o texto guardado de "r1.txt"');
  });

  it("versão desatualizada é recusada pelo DO e o texto novo não é dado como gravado", async () => {
    const a = ambiente();
    const caso = casoAvulso();
    caso.fontes.push(fonte("r1.txt", "transcricao", "fala do lead"));
    expect(await salvarCaso(a.env, "u1", caso.id, caso, { versao: 7 })).toMatchObject({ ok: false, motivo: "versao" });
    // Na próxima tentativa o texto sobe de novo (idempotente): o objeto é o mesmo por hash.
    expect(await salvarCaso(a.env, "u1", caso.id, caso, { versao: 0 })).toMatchObject({ ok: true });
    expect(a.puts).toHaveLength(2);
  });
});
