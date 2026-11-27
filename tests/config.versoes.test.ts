/**
 * Versão da config de prompt gravada no caso e critério do alerta de "versão anterior".
 * A integração com a fila e o D1 fica em tests/workers/consumidor.test.ts; aqui, a lógica pura.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { casoAvulso, copiarCaso, descartarRascunho, hashTexto, publicoCaso, restaurarCaso, type Caso } from "../lib/caso";
import { leitura, rascunho } from "../lib/pipeline";
import { configVazia, type ConfigPrompt } from "../lib/prompt-tipos";
import { canonico, type SchemaName } from "../lib/schemas";
import { chaveDispensa, temPersonalizacao, versaoDesatualizada } from "../components/chat/configPrompt";

const canned = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "canned.json"), "utf-8"));
const chat = async <T,>(_s: string, _u: string, schema: SchemaName) => canonico<T>(structuredClone(canned[schema]), schema);
const cfg = (versao: number): ConfigPrompt => configVazia(versao);
const semProgresso = () => {};

/** Caso com carteira já lida e uma transcrição ainda não lida. */
function casoComTranscricao(texto = "Assessor: e a retirada?\nLead: preciso de 10 mil por mês."): Caso {
  const c = casoAvulso();
  c.fontes = [
    { nome: "c.csv", papel: "carteira", origemPapel: "usuario", texto: "a;b", hash: "h-cart", ativos: canned.AtivosOut.ativos, dataPosicao: "" },
    { nome: "r1.txt", papel: "transcricao", origemPapel: "usuario", texto, hash: hashTexto(texto) },
  ];
  return c;
}

describe("o caso grava a versão da config usada em cada etapa", () => {
  it("leitura grava lead; rascunho grava rascunho; sem config a versão é 0", async () => {
    const c = casoComTranscricao();
    expect(c.configVersoes).toBeUndefined();
    await leitura(c, chat, semProgresso, cfg(3));
    expect(c.configVersoes).toEqual({ lead: 3 });
    await rascunho(c, chat, semProgresso, 0, 85, cfg(4));
    expect(c.configVersoes).toEqual({ lead: 3, rascunho: 4 });

    const sem = casoComTranscricao();
    await leitura(sem, chat, semProgresso);
    await rascunho(sem, chat, semProgresso);
    expect(sem.configVersoes).toEqual({ lead: 0, rascunho: 0 });
  });

  it("leitura que não refaz o lead mantém a versão dele, mas descarta o rascunho e a versão dele", async () => {
    const c = casoComTranscricao();
    await leitura(c, chat, semProgresso, cfg(3));
    await rascunho(c, chat, semProgresso, 0, 85, cfg(3));
    c.fontes.push({ nome: "c2.csv", papel: "carteira", origemPapel: "usuario", texto: "x;y", hash: "h-cart2", ativos: canned.AtivosOut.ativos, dataPosicao: "" });
    await leitura(c, chat, semProgresso, cfg(9)); // carteira nova; a transcrição é a mesma
    expect(c.rascunho).toBeUndefined();
    expect(c.configVersoes).toEqual({ lead: 3 });
  });

  it("transcrição nova refaz o lead com a config atual", async () => {
    const c = casoComTranscricao();
    await leitura(c, chat, semProgresso, cfg(3));
    await rascunho(c, chat, semProgresso, 0, 85, cfg(3));
    const t2 = "Outra reunião.";
    c.fontes.push({ nome: "r2.txt", papel: "transcricao", origemPapel: "usuario", texto: t2, hash: hashTexto(t2) });
    await leitura(c, chat, semProgresso, cfg(5));
    expect(c.configVersoes).toEqual({ lead: 5 });
  });

  it("descartarRascunho limpa só a versão do rascunho e remove o objeto quando fica vazio", () => {
    const c = casoAvulso();
    descartarRascunho(c); // sem configVersoes: não quebra
    expect(c.configVersoes).toBeUndefined();
    c.configVersoes = { lead: 2, rascunho: 2 };
    descartarRascunho(c);
    expect(c.configVersoes).toEqual({ lead: 2 });
    c.configVersoes = { rascunho: 2 };
    descartarRascunho(c);
    expect("configVersoes" in c && c.configVersoes !== undefined).toBe(false);
  });

  it("cancelar restaura as versões do instantâneo, inclusive a ausência delas", async () => {
    const c = casoComTranscricao();
    const antes = copiarCaso(c);
    await leitura(c, chat, semProgresso, cfg(7));
    expect(c.configVersoes).toEqual({ lead: 7 });
    restaurarCaso(c, antes);
    expect(c.configVersoes).toBeUndefined();
    await leitura(c, chat, semProgresso, cfg(7));
    const meio = copiarCaso(c);
    await rascunho(c, chat, semProgresso, 0, 85, cfg(8));
    restaurarCaso(c, meio);
    expect(c.configVersoes).toEqual({ lead: 7 });
  });

  it("publicoCaso expõe configVersoes; caso salvo antes do recurso vira {}, sem alterar o caso", async () => {
    const antigo = casoAvulso();
    expect(publicoCaso(antigo).configVersoes).toEqual({});
    const c = casoComTranscricao();
    await leitura(c, chat, semProgresso, cfg(2));
    const pub = publicoCaso(c);
    expect(pub.configVersoes).toEqual({ lead: 2 });
    pub.configVersoes.lead = 99; // a cópia pública não aponta para o estado do caso
    expect(c.configVersoes).toEqual({ lead: 2 });
    expect(JSON.parse(JSON.stringify(publicoCaso(c))).configVersoes).toEqual({ lead: 2 });
  });
});

describe("alerta de versão anterior (critério do front)", () => {
  it("sem versões gravadas (conversa sem lead nem rascunho): sem alerta", () => {
    expect(versaoDesatualizada({}, 3)).toBe(false);
    expect(versaoDesatualizada(undefined, 3)).toBe(false);
    expect(versaoDesatualizada(null, 3)).toBe(false);
  });
  it("versões iguais à atual: sem alerta", () => {
    expect(versaoDesatualizada({ lead: 3, rascunho: 3 }, 3)).toBe(false);
    expect(versaoDesatualizada({ lead: 3 }, 3)).toBe(false);
  });
  it("lead com versão diferente: alerta, mesmo sem rascunho", () => {
    expect(versaoDesatualizada({ lead: 2 }, 3)).toBe(true);
    expect(versaoDesatualizada({ lead: 2, rascunho: 3 }, 3)).toBe(true);
  });
  it("rascunho com versão diferente: alerta", () => {
    expect(versaoDesatualizada({ rascunho: 2 }, 3)).toBe(true);
    expect(versaoDesatualizada({ lead: 3, rascunho: 2 }, 3)).toBe(true);
  });
  it("configAtual 0 com versões 0: sem alerta; versão 0 gravada e atual maior: alerta", () => {
    expect(versaoDesatualizada({ lead: 0, rascunho: 0 }, 0)).toBe(false);
    expect(versaoDesatualizada({ lead: 0 }, 1)).toBe(true);
  });
  it("configAtual ainda desconhecida: sem alerta", () => {
    expect(versaoDesatualizada({ lead: 0 }, null)).toBe(false);
    expect(versaoDesatualizada({ lead: 0 }, undefined)).toBe(false);
  });
  it("a dispensa é por conversa e volta se a versão atual ou as usadas mudarem", () => {
    const base = chaveDispensa("c1", { lead: 1, rascunho: 2 }, 3);
    expect(chaveDispensa("c1", { lead: 1, rascunho: 2 }, 3)).toBe(base);
    expect(chaveDispensa("c2", { lead: 1, rascunho: 2 }, 3)).not.toBe(base);
    expect(chaveDispensa("c1", { lead: 1, rascunho: 2 }, 4)).not.toBe(base);
    expect(chaveDispensa("c1", { lead: 1 }, 3)).not.toBe(base);
  });
});

describe("ponto de personalização no ícone", () => {
  it("só conta bloco original alterado/desligado ou instrução própria ligada", () => {
    expect(temPersonalizacao(null)).toBe(false);
    expect(temPersonalizacao({ alterados: {}, extras: [] })).toBe(false);
    expect(temPersonalizacao({ alterados: {}, extras: [{ ativo: false }] })).toBe(false);
    expect(temPersonalizacao({ alterados: {}, extras: [{ ativo: true }] })).toBe(true);
    expect(temPersonalizacao({ alterados: { "diagnostico.riscos": { texto: "x", ativo: false } }, extras: [] })).toBe(true);
  });
});

describe("links entre o chat e a página de instruções", () => {
  const id = "a".repeat(32);
  it("engrenagem leva a conversa só se o id é válido", async () => {
    const { hrefConfig } = await import("../components/chat/configPrompt");
    expect(hrefConfig(id)).toBe(`/configuracoes/prompt?voltar=${id}`);
    for (const ruim of [null, undefined, "", "novo", "A".repeat(32), "a".repeat(31), `${id}&x=1`]) expect(hrefConfig(ruim)).toBe("/configuracoes/prompt");
  });
  it("voltar ao chat nunca sai do site", async () => {
    const { hrefChat } = await import("../components/chat/configPrompt");
    expect(hrefChat(id)).toBe(`/?c=${id}`);
    for (const ruim of [undefined, "//evil.com", "https://evil.com", "/\\evil", ["a"], `${id}\n`]) expect(hrefChat(ruim)).toBe("/");
  });
});
