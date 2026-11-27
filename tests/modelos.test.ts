import { afterEach, describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { FAIXAS, faixaDe, janelaContexto, limiteContexto } from "@/lib/modelos";

const modeloOriginal = config.modelId;
const contextoOriginal = config.contextoTokens;

afterEach(() => {
  config.modelId = modeloOriginal;
  config.contextoTokens = contextoOriginal;
});

describe("janelaContexto", () => {
  it("usa 1M para Sonnet 4.6 e Opus 4.6, com ou sem prefixo regional", () => {
    expect(janelaContexto("us.anthropic.claude-sonnet-4-6")).toBe(1_000_000);
    expect(janelaContexto("eu.anthropic.claude-sonnet-4-6")).toBe(1_000_000);
    expect(janelaContexto("global.anthropic.claude-opus-4-6-v1")).toBe(1_000_000);
    expect(janelaContexto("anthropic.claude-opus-4-6-v1")).toBe(1_000_000);
    expect(janelaContexto("claude-sonnet-4-6")).toBe(1_000_000);
  });

  it("usa 1M para a família Claude 5 (Opus 5.5, Sonnet 5.5, Haiku 5.5)", () => {
    expect(janelaContexto("anthropic.claude-opus-5-5")).toBe(1_000_000);
    expect(janelaContexto("us.anthropic.claude-sonnet-5-5")).toBe(1_000_000);
    expect(janelaContexto("anthropic.claude-haiku-5-5")).toBe(1_000_000);
  });

  it("usa 200k para Sonnet 4.5, Opus 4.5, Opus 4.1 e Haiku 4.5", () => {
    expect(janelaContexto("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(200_000);
    expect(janelaContexto("apac.anthropic.claude-opus-4-5-20251101-v1:0")).toBe(200_000);
    expect(janelaContexto("us.anthropic.claude-opus-4-1-20250805-v1:0")).toBe(200_000);
    expect(janelaContexto("us.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(200_000);
  });

  it("casa Opus 4 genérico com 200k sem confundir com Opus 4.6", () => {
    expect(janelaContexto("anthropic.claude-opus-4-20250514-v1:0")).toBe(200_000);
    expect(janelaContexto("anthropic.claude-opus-4-6-v1")).toBe(1_000_000);
  });

  it("cobre Claude 3.x com 200k", () => {
    expect(janelaContexto("anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(200_000);
    expect(janelaContexto("anthropic.claude-3-7-sonnet-20250219-v1:0")).toBe(200_000);
    expect(janelaContexto("anthropic.claude-3-haiku-20240307-v1:0")).toBe(200_000);
    expect(janelaContexto("anthropic.claude-3-opus-20240229-v1:0")).toBe(200_000);
  });

  it("não casa família por prefixo de texto parcial", () => {
    // "claude-sonnet-4-60" não existe; não pode cair em Sonnet 4.6.
    expect(janelaContexto("anthropic.claude-sonnet-4-60")).toBe(200_000);
  });

  it("usa 200k para modelo desconhecido", () => {
    expect(janelaContexto("us.meta.llama3-70b")).toBe(200_000);
    expect(janelaContexto("")).toBe(200_000);
  });
});

describe("limiteContexto", () => {
  it("usa a janela do modelo quando ATLAS_CONTEXTO_TOKENS é 0", () => {
    config.modelId = "us.anthropic.claude-sonnet-4-6";
    config.contextoTokens = 0;
    expect(limiteContexto()).toBe(1_000_000);
  });

  it("usa ATLAS_CONTEXTO_TOKENS quando é maior que 0", () => {
    config.modelId = "us.anthropic.claude-sonnet-4-6";
    config.contextoTokens = 200_000;
    expect(limiteContexto()).toBe(200_000);
  });
});

describe("faixaDe", () => {
  it("muda nas fronteiras 60, 85 e 95", () => {
    expect(faixaDe(0)).toBe(0);
    expect(faixaDe(59.9)).toBe(0);
    expect(faixaDe(60)).toBe(60);
    expect(faixaDe(84.9)).toBe(60);
    expect(faixaDe(85)).toBe(85);
    expect(faixaDe(94.9)).toBe(85);
    expect(faixaDe(95)).toBe(95);
    expect(faixaDe(120)).toBe(95);
  });

  it("expõe as faixas como constantes", () => {
    expect(FAIXAS).toEqual([60, 85, 95]);
  });
});
