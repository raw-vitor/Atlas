import { describe, expect, it } from "vitest";
import * as calc from "../lib/calc";
import { numerosCitados } from "../lib/citados";
import { checarDados, checarRascunho, norm, valores } from "../lib/validate";
import type { Alocacao, Ativo, Decisao, Diagnostico, Lead } from "../lib/types";

const lead = (o: Partial<Lead> = {}): Lead => ({ primeiro_nome: "Ana", situacao: [], objetivos: [], restricoes: [], frases_literais: [],
  perfil: "Conservador", freio_principal: "", aporte_mensal: 0, meta_patrimonio_citada: "", lacunas: [], ...o });
const ativos: Ativo[] = [{ nome: "CDB Banco X", emissor: "Banco X", classe: "Pós-fixado", subclasse: "CDB", liquidez: "diária",
  vencimento: "", valor: 1164342.84, fora_do_depara: false }];
const an = calc.analisar(ativos);
const aloc: Alocacao = { titulo_slide: "", cards: [], fases: [], sub_rf_texto: "",
  classes: [{ classe: "Pós-fixado", pct_proposto: 100, para_detalhe: "Pós-fixado curto", porque: "reserva e retiradas mensais", objetivo: "", fase: 1 }] };
const diag = (o: Partial<Diagnostico> = {}): Diagnostico => ({ frase_contradicao: "", disse: [], titulo_disse: "", acertos: [], titulo_acertou: "",
  riscos: [], titulo_riscos: "", ganho_titulo: "", ganho_numero: "", ganho_descricao: "", ganho_detalhes: [], ganho_passos: [], falta: [], perguntas: [], ...o });
const dec = (o: Partial<Decisao> = {}): Decisao => ({ hoje_numero: "", hoje_texto: "", hoje_detalhes: [], pedido: "", garantias: [], condicoes: [],
  resumo_itens: [], frase_lead_repete: "", diferencial_motivo: "", ...o });
const avisosDeValor = (l: Lead, d: Diagnostico, de: Decisao, tr = "") =>
  checarRascunho(l, ativos, an, aloc, d, de, {}, tr).filter((a) => a.tipo === "valor");

describe("valores em reais", () => {
  it("milhão não vira mil", () => {
    expect(valores("R$ 1,2 milhão")).toEqual([1_200_000]);
    expect(valores("R$ 3 milhões e R$ 10 mil e R$ 2 mi")).toEqual([3_000_000, 10_000, 2_000_000]);
    expect(valores("R$ 10 minutos")).toEqual([10]);
  });
  it("numerosCitados entende as formas de falar e ignora o assessor", () => {
    expect(numerosCitados("Lead: 10 mil, R$ 10 mil, R$ 10.000, 1,2 milhão e 600 mil reais\nAssessor: R$ 500 mil")).toEqual([10_000, 10_000, 10_000, 1_200_000, 600_000]);
  });
});

describe("checarRascunho: avisos de valor", () => {
  it("valor citado pelo lead não gera aviso", () => {
    const l = lead({ objetivos: ["retirada de R$ 10 mil por mês"] });
    const d = diag({ riscos: [{ rotulo: "Retirada", numero: "R$ 10 mil", texto: "retirada de R$ 10 mil por mês" }] });
    expect(avisosDeValor(l, d, dec(), "Lead: preciso tirar uns 10 mil por mês")).toEqual([]);
    // Só na transcrição também vale.
    expect(avisosDeValor(lead(), d, dec(), "Lead: preciso tirar uns 10 mil por mês")).toEqual([]);
    // Dito pelo assessor não vale.
    expect(avisosDeValor(lead(), d, dec(), "Assessor: uns 10 mil por mês?")).toHaveLength(1);
  });
  it("valor inventado repetido em 3 campos gera um aviso só, com campo e ocorrências", () => {
    const d = diag({ riscos: [{ rotulo: "Risco", numero: "R$ 77.777", texto: "perda de R$ 77.777" }] });
    const av = avisosDeValor(lead(), d, dec({ hoje_numero: "R$ 77.777" }));
    expect(av).toHaveLength(1);
    expect(av[0]).toMatchObject({ valor: 77777, campo: "slide Riscos", trecho: "R$ 77.777", ocorrencias: 3 });
    expect(av[0].texto).toBe('R$ 77.777 no slide Riscos ("R$ 77.777"): não está nos números calculados nem na fala do lead. Confira. ' +
      "Aparece em 3 trechos (slide Riscos; slide A Decisão, número de hoje).");
  });
  it("trecho longo é cortado em volta do valor", () => {
    const longo = `${"a".repeat(120)} R$ 77.777 ${"b".repeat(120)}`;
    const [av] = avisosDeValor(lead(), diag({ frase_contradicao: longo }), dec());
    expect(av.trecho).toContain("R$ 77.777");
    expect(av.trecho!.length).toBeLessThanOrEqual(82);
    expect(av.campo).toBe("diagnóstico, frase de contradição");
  });
});

describe("checarDados e norm", () => {
  it("citação quebrada em duas linhas na transcrição é encontrada", () => {
    const l = lead({ frases_literais: ["não teve nada horrível, nada"] });
    expect(checarDados(l, ativos, an, "Ana: não teve nada\nhorrível,  nada que me assustasse")[0]).toEqual([]);
    expect(checarDados(lead({ frases_literais: ["nunca foi dito"] }), ativos, an, "Ana: oi")[0][0].tipo).toBe("citacao");
  });
  it("norm troca pontuação por espaço e o emissor continua detectado", () => {
    expect(norm("Pós-fixado · Bradesco\n curto")).toBe("pos fixado bradesco curto");
    const a = { ...aloc, classes: [{ ...aloc.classes[0], para_detalhe: "Pós-fixado · Bradesco · curto" }] };
    const av = checarRascunho(lead(), ativos, an, a, diag(), dec(), {});
    expect(av.filter((x) => x.tipo === "emissor").map((x) => x.texto)).toEqual(["'Para' de Pós-fixado cita emissor/produto: \"Pós-fixado · Bradesco · curto\"."]);
  });
});

describe("regressão: caso Ana", () => {
  it("R$ 10 mil dito pelo lead não avisa; R$ 200.000 sem origem avisa uma vez no slide Riscos", () => {
    expect(an.total).toBe(1164342.84);
    const l = lead({ objetivos: ["retirada de R$ 10 mil por mês"], situacao: ["aposentada"] });
    const tr = "Assessor: e quanto você precisa por mês?\nLead: preciso tirar uns 10 mil por mês, não teve nada horrível";
    const d = diag({
      disse: [{ frase: "preciso tirar uns 10 mil por mês", numero: "R$ 10 mil", leitura: "R$ 10 mil por mês sai da carteira" }],
      riscos: [{ rotulo: "Reserva", numero: "R$ 200.000", texto: "sem colchão para R$ 10 mil por mês" }],
      ganho_detalhes: ["retirada de R$ 10.000 por mês"],
    });
    const de = dec({ hoje_texto: "R$ 10 mil por mês com segurança", resumo_itens: ["Retirada de R$ 10 mil/mês"] });
    const av = avisosDeValor(l, d, de, tr);
    expect(av).toHaveLength(1);
    expect(av[0].valor).toBe(200_000);
    expect(av[0].texto).toContain("slide Riscos");
    expect(av[0].ocorrencias).toBe(1);
  });
});
