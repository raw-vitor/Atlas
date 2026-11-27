import { beforeEach, describe, expect, it, vi } from "vitest";

const perguntar = vi.fn();
vi.mock("../lib/bedrock", () => ({ perguntarJson: (...a: unknown[]) => perguntar(...a) }));

import { analisar } from "../lib/calc";
import { CanceladoError } from "../lib/cancelamento";
import { casoAvulso, hashTexto, MAX_TRANSCRICAO_CHARS, registrar, type Rascunho } from "../lib/caso";
import { FALHA_PERGUNTA, responderPergunta, trechosDaTranscricao } from "../lib/conversa";
import type { Alocacao, Ativo, Decisao, Diagnostico, Lead } from "../lib/types";

const uso = { chamadas: 0, entrada: 0, saida: 0 };
const lead: Lead = { primeiro_nome: "Ana", situacao: ["Aposentada"], objetivos: ["Retirada de R$ 10 mil por mês"], restricoes: [],
  frases_literais: ["Preciso tirar uns 10 mil por mês"], perfil: "Conservador", freio_principal: "", aporte_mensal: 0,
  meta_patrimonio_citada: "", lacunas: [] };
const ativos: Ativo[] = [
  { nome: "CDB Banco X", emissor: "Banco X", classe: "Pós-fixado", subclasse: "Bancário com FGC", liquidez: "D+0", vencimento: "2027-01-01", valor: 300_000, fora_do_depara: false },
  { nome: "Tesouro IPCA 2035", emissor: "Tesouro", classe: "Inflação (IPCA+)", subclasse: "Título público", liquidez: "D+1", vencimento: "2035-05-15", valor: 200_000, fora_do_depara: false },
];
const R1 = "Assessor: e como você usa o dinheiro hoje?\nLead: Preciso tirar uns 10 mil por mês para as despesas da casa.\nAssessor: entendi.";
const rascunho = (): Rascunho => ({
  aloc: { titulo_slide: "Proposta", classes: [], cards: [], fases: [], sub_rf_texto: "" } as Alocacao,
  diag: { frase_contradicao: "Você quer renda, mas a carteira está parada." } as Diagnostico,
  dec: { hoje_numero: "R$ 10.000", hoje_texto: "por mês de retirada" } as Decisao,
  notas: {}, pendencias: ["Confirmar o emissor do CDB"], dataR2: "2025-06-10",
  avisos: [{ tipo: "valor", texto: "R$ 10.000 no slide A Decisão: confira.", motivo: "não está nos números calculados nem na fala do lead",
    campo: "slide A Decisão, número de hoje", trecho: "R$ 10.000 por mês de retirada", valor: 10_000, ocorrencias: 6 }],
});
function caso(texto = R1) {
  const c = casoAvulso();
  c.fontes = [{ nome: "r1.txt", papel: "transcricao", origemPapel: "usuario", texto, hash: hashTexto(texto) }];
  c.lead = lead; c.ativos = ativos; c.analise = analisar(ativos);
  return c;
}
const prompt = () => perguntar.mock.calls[0][1] as string;

describe("responderPergunta", () => {
  beforeEach(() => { perguntar.mockReset(); perguntar.mockResolvedValue({ resposta: "O R$ 10 mil é a retirada que a Ana citou na R1.", fontes: [] }); });

  it("o prompt traz a fala do lead, os fatos, os slides e o aviso com campo, motivo e trecho", async () => {
    const c = caso(); c.rascunho = rascunho();
    await responderPergunta(c, "por que o 10 mil não bate?", uso);
    const p = prompt();
    expect(p).toContain("Preciso tirar uns 10 mil por mês");
    expect(p).toContain('"primeiro_nome":"Ana"');
    expect(p).toContain("Patrimônio financeiro do estudo: R$ 500.000,00");
    expect(p).toContain("CDB Banco X | Pós-fixado | R$ 300.000,00");
    expect(p).toContain('"hoje_numero":"R$ 10.000"');
    expect(p).toContain("motivo: não está nos números calculados nem na fala do lead");
    expect(p).toContain("campo: slide A Decisão, número de hoje");
    expect(p).toContain('trecho: "R$ 10.000 por mês de retirada"');
    expect(p).toContain("aparece 6 vezes");
    expect(p).toContain("Confirmar o emissor do CDB");
    expect(p).not.toContain("ainda não foram gerados");
    expect(perguntar.mock.calls[0][4]).toBe(1500);
  });

  it("sem rascunho, o prompt diz que os slides ainda não foram gerados", async () => {
    await responderPergunta(caso(), "o que diz o slide de decisão?", uso);
    expect(prompt()).toContain("SLIDES: ainda não foram gerados");
    expect(perguntar.mock.calls[0][0]).toContain("ainda não foram gerados");
  });

  it("transcrição maior que o limite: vão só os trechos com as palavras da pergunta, com as linhas vizinhas", async () => {
    const enchimento = Array.from({ length: Math.ceil(MAX_TRANSCRICAO_CHARS / 30) }, (_, i) => `Lead: falei do tempo e de viagens ${i}.`);
    const meio = enchimento.length >> 1;
    enchimento.splice(meio, 0, "Assessor: e a renda?", "Lead: quero retirar uns 10 mil por mês.", "Assessor: anotado.");
    const texto = enchimento.join("\n");
    expect(texto.length).toBeGreaterThan(MAX_TRANSCRICAO_CHARS);
    await responderPergunta(caso(texto), "Por que o valor de 10.000 da retirada não bate?", uso);
    const p = prompt();
    expect(p).toContain("Assessor: e a renda?\nLead: quero retirar uns 10 mil por mês.\nAssessor: anotado.");
    expect(p).toContain("só os trechos com as palavras da pergunta");
    expect(p.match(/falei do tempo/g)?.length ?? 0).toBe(0);
    expect(p.length).toBeLessThan(10_000);
  });

  it("o histórico entra no prompt sem repetir a pergunta atual", async () => {
    const c = caso();
    registrar(c, "assessor", "qual o perfil dela?");
    registrar(c, "atlas", "Conservador, segundo a R1.");
    const pergunta = "e quanto ela quer retirar por mês?";
    registrar(c, "assessor", pergunta);
    await responderPergunta(c, pergunta, uso);
    const p = prompt();
    expect(p).toContain("Assessor: qual o perfil dela?\nAtlas: Conservador, segundo a R1.");
    expect(p.split(pergunta).length - 1).toBe(1);
    expect(p.trimEnd().endsWith(pergunta)).toBe(true);
  });

  it("as fontes viram a linha final; fonte desconhecida é descartada", async () => {
    perguntar.mockResolvedValue({ resposta: " A Ana disse na R1 que precisa de 10 mil por mês. ", fontes: ["transcricao", "slides", "transcricao", "toString"] });
    expect(await responderPergunta(caso(), "x", uso)).toBe("A Ana disse na R1 que precisa de 10 mil por mês.\n\nFontes: transcrição da R1, slides.");
    perguntar.mockResolvedValue({ resposta: "Não encontrei isso no caso.", fontes: [] });
    expect(await responderPergunta(caso(), "x", uso)).toBe("Não encontrei isso no caso.");
  });

  it("erro ou resposta inválida do LLM devolvem o texto de fallback; cancelamento é relançado", async () => {
    perguntar.mockRejectedValue(new Error("timeout"));
    expect(await responderPergunta(caso(), "x", uso)).toBe(FALHA_PERGUNTA);
    perguntar.mockResolvedValue({ resposta: "  ", fontes: [] });
    expect(await responderPergunta(caso(), "x", uso)).toBe(FALHA_PERGUNTA);
    perguntar.mockResolvedValue(null);
    expect(await responderPergunta(caso(), "x", uso)).toBe(FALHA_PERGUNTA);
    perguntar.mockRejectedValue(new CanceladoError());
    await expect(responderPergunta(caso(), "x", uso)).rejects.toBeInstanceOf(CanceladoError);
  });

  it("não altera o caso", async () => {
    const c = caso(); c.rascunho = rascunho();
    registrar(c, "assessor", "por que o 10 mil não bate?");
    const antes = structuredClone(c);
    await responderPergunta(c, "por que o 10 mil não bate?", uso);
    expect(c).toEqual(antes);
  });
});

describe("trechosDaTranscricao", () => {
  const linhas = ["Lead: bom dia.", "Lead: tenho previdência no banco.", "Assessor: certo.", "Lead: gosto de viajar.",
    "Lead: o resto fica parado.", "Lead: preciso de R$ 10 mil todo mês.", "Assessor: ok."];
  const texto = linhas.join("\n");

  it("até o limite, a transcrição vai inteira", () => {
    expect(trechosDaTranscricao(texto, "qualquer coisa", texto.length)).toBe(texto);
  });
  it("acima do limite: ignora acento e caixa, casa 10.000 com 10 mil e marca o corte", () => {
    const t = trechosDaTranscricao(texto, "Ela falou da PREVIDENCIA e dos 10.000?", 160);
    expect(t).toBe("Lead: bom dia.\nLead: tenho previdência no banco.\nAssessor: certo.\n[...]\nLead: o resto fica parado.\nLead: preciso de R$ 10 mil todo mês.\nAssessor: ok.");
    expect(t.length).toBeLessThanOrEqual(160);
  });
  it("com pouco espaço, entra primeiro o trecho que casa mais termos", () => {
    const t = trechosDaTranscricao(texto, "previdencia de 10 mil", 90);
    expect(t).toContain("R$ 10 mil");
    expect(t).not.toContain("previdência");
  });
  it("pergunta só com palavras curtas ou comuns não traz trecho", () => {
    expect(trechosDaTranscricao(texto, "e o que é isso?", 50)).toBe("");
  });
});
