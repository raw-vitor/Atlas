/** Medidor de contexto (D4/D5): real quando o turno carregou o caso, estimado quando não; partes que somam o total. */
import { describe, expect, it } from "vitest";
import { casoAvulso, hashTexto, type Caso } from "../lib/caso";
import { LLMError } from "../lib/bedrock";
import { classeDoErro, ErroDeTarefa, MSG_ERRO_GENERICO, MSG_ERRO_MODELO, mensagemDeErro } from "../lib/tarefas/execucao/erros";
import { CHARS_POR_TOKEN, caracteresDoPrompt, medirContexto, repartir } from "../lib/tarefas/execucao/medidor";
import { validarPayloadTurno } from "../lib/tarefas/turno";
import { validarPayloadDeck } from "../lib/tarefas/deck";

function caso(chars: { tr?: number; carteira?: number }): Caso {
  const c = casoAvulso();
  const tr = "x".repeat(chars.tr ?? 0), ct = "y".repeat(chars.carteira ?? 0);
  if (tr) c.fontes.push({ nome: "r1.txt", papel: "transcricao", origemPapel: "usuario", texto: tr, hash: hashTexto(tr) });
  if (ct) c.fontes.push({ nome: "c.csv", papel: "carteira", origemPapel: "usuario", texto: ct, hash: hashTexto(ct) });
  return c;
}

describe("medirContexto", () => {
  it("usa o maior inputTokens real quando ele é ao menos metade do que o caso pesa", () => {
    const c = caso({ tr: 70_000 });
    const m = medirContexto(c, 21_000, 200_000);
    expect(m).toMatchObject({ tokens: 21_000, limite: 200_000, pct: 10.5, estimado: false });
    expect(Object.values(m.partes).reduce((a, b) => a + b, 0)).toBe(21_000);
    expect(m.partes.transcricao).toBeGreaterThan(m.partes.outros);
  });

  it("sem nenhuma chamada (maiorEntrada 0) estima por caracteres ÷ 3,5 e marca como estimado", () => {
    const c = caso({ tr: 70_000 });
    const chars = caracteresDoPrompt(c);
    const total = chars.transcricao + chars.carteira + chars.historico + chars.outros;
    const m = medirContexto(c, 0, 200_000);
    expect(m.estimado).toBe(true);
    expect(m.tokens).toBe(Math.ceil(total / CHARS_POR_TOKEN));
    expect(chars.transcricao).toBe(70_000);
  });

  it("chamada pequena demais para ter carregado o caso (só a instrução) também vira estimativa", () => {
    const m = medirContexto(caso({ tr: 70_000 }), 900, 200_000);
    expect(m.estimado).toBe(true);
    expect(m.tokens).toBeGreaterThan(10_000);
  });

  it("a transcrição conta no máximo o que o prompt aceita (200 mil caracteres)", () => {
    expect(caracteresDoPrompt(caso({ tr: 500_000 })).transcricao).toBe(200_000);
  });

  it("carteira ainda sem leitura pesa pelo texto do arquivo; depois de lida, pela lista de ativos", () => {
    const c = caso({ carteira: 40_000 });
    expect(caracteresDoPrompt(c).carteira).toBe(40_000);
    c.fontes[0].ativos = [];
    c.ativos = [{ nome: "CDB X", classe: "Pós-fixado" } as never];
    expect(caracteresDoPrompt(c).carteira).toBeLessThan(100);
  });

  it("acima do limite a porcentagem passa de 100 (o front limita o anel)", () => {
    expect(medirContexto(casoAvulso(), 250_000, 200_000)).toMatchObject({ pct: 125, estimado: false });
  });
});

describe("repartir", () => {
  it("soma exatamente o total, na proporção das partes", () => {
    expect(repartir(100, { transcricao: 1, carteira: 1, historico: 1, outros: 1 })).toEqual({ transcricao: 25, carteira: 25, historico: 25, outros: 25 });
    const r = repartir(10, { transcricao: 1, carteira: 1, historico: 1, outros: 0 });
    expect(Object.values(r).reduce((a, b) => a + b, 0)).toBe(10);
    expect(r.outros).toBe(0);
  });
  it("sem tokens ou sem caracteres devolve zeros", () => {
    expect(repartir(0, { transcricao: 5, carteira: 0, historico: 0, outros: 0 })).toEqual({ transcricao: 0, carteira: 0, historico: 0, outros: 0 });
    expect(repartir(10, { transcricao: 0, carteira: 0, historico: 0, outros: 0 })).toEqual({ transcricao: 0, carteira: 0, historico: 0, outros: 0 });
  });
});

describe("classe do erro para o log", () => {
  it("diz o código HTTP do Bedrock sem repetir a mensagem (que pode citar o lead)", () => {
    const erro = new LLMError("Falha ao obter JSON válido do modelo: Error: Bedrock HTTP 429: {\"message\":\"trecho do lead\"}");
    expect(classeDoErro(erro)).toBe("LLMError HTTP 429");
    expect(classeDoErro(new LLMError("Chave do Bedrock ausente"))).toBe("LLMError");
    expect(classeDoErro(new TypeError("x"))).toBe("TypeError");
    expect(classeDoErro("solto")).toBe("desconhecido");
  });
});

describe("mensagem de erro para a tela", () => {
  it("erro do modelo vira texto fixo; erro interno não vaza; mensagem de domínio passa", () => {
    expect(mensagemDeErro(new LLMError("Bedrock HTTP 500: {\"message\":\"trecho do lead\"}"))).toBe(MSG_ERRO_MODELO);
    expect(mensagemDeErro(new TypeError("Cannot read properties of undefined (reading 'lead')"))).toBe(MSG_ERRO_GENERICO);
    expect(mensagemDeErro("string solta")).toBe(MSG_ERRO_GENERICO);
    expect(mensagemDeErro(new Error("O rascunho ainda não existe."))).toBe("O rascunho ainda não existe.");
    expect(mensagemDeErro(new ErroDeTarefa("Formato não suportado em \"x.exe\": .exe."))).toBe("Formato não suportado em \"x.exe\": .exe.");
    expect(mensagemDeErro(new Error("x".repeat(1000))).length).toBe(300);
  });
});

describe("payload das tarefas", () => {
  const anexo = { chave: "u/a/c/b/anexos/1-x.txt", nome: "x.txt", tamanho: 3, tipo: "text/plain" };
  it("turno: aceita o formato do contrato e recusa o resto", () => {
    expect(validarPayloadTurno({ texto: "oi", anexos: [anexo], mensagemId: "m1" })).toEqual({ texto: "oi", anexos: [anexo], mensagemId: "m1" });
    expect(validarPayloadTurno({ texto: "", anexos: [], mensagemId: "m1" })).not.toBeNull();
    for (const ruim of [null, "x", { texto: "oi" }, { texto: 1, anexos: [], mensagemId: "m" }, { texto: "", anexos: [], mensagemId: "" },
      { texto: "", anexos: [{ nome: "x" }], mensagemId: "m" }, { texto: "", anexos: [{ ...anexo, tamanho: "3" }], mensagemId: "m" }])
      expect(validarPayloadTurno(ruim)).toBeNull();
  });
  it("deck: só a ação gerar", () => {
    expect(validarPayloadDeck({ acao: "gerar" })).toEqual({ acao: "gerar" });
    expect(validarPayloadDeck({ acao: "outra" })).toBeNull();
    expect(validarPayloadDeck(null)).toBeNull();
  });
});
