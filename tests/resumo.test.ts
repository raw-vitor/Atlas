import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { casoAvulso, hashTexto, publicoCaso } from "../lib/caso";
import { resumoDoCaso } from "../lib/resumo";
import type { Lead } from "../lib/types";

const tr = fs.readFileSync(path.join(__dirname, "fixtures/transcricao_sem_carteira.txt"), "utf-8");
const lead = (o: Partial<Lead> = {}): Lead => ({ primeiro_nome: "Carlos", situacao: [], objetivos: ["Aposentar aos 60"], restricoes: [], frases_literais: [],
  perfil: "Conservador", freio_principal: "", aporte_mensal: 0, meta_patrimonio_citada: "", lacunas: [], ...o });
function caso(texto: string, l: Lead) {
  const c = casoAvulso();
  c.fontes = [{ nome: "r1.txt", papel: "transcricao", origemPapel: "usuario", texto, hash: hashTexto(texto) }];
  c.lead = l;
  return c;
}

describe("resumo: o que fazer quando falta algo", () => {
  it("só falta a carteira e a R1 cita valor: oferece as 2 opções com o trecho", () => {
    const c = caso(tr, lead());
    const t = resumoDoCaso(c, []);
    expect(t).toContain("Falta a carteira do lead. Escolha uma opção:");
    expect(t).toContain("1. Enviar a carteira");
    expect(t).toContain('2. Usar só a transcrição: a R1 cita "R$ 600 mil concentrados em CDB"');
    expect(t).not.toContain("Carteira com ao menos 1 ativo");
    expect(publicoCaso(c).opcoes).toEqual([{ id: "usar_transcricao", rotulo: "Usar valores da transcrição" }]);
  });
  it("sem valor citado: só pede a carteira e não oferece botão", () => {
    const c = caso("Lead: sou conservador.\nAssessor: certo.", lead());
    const t = resumoDoCaso(c, []);
    expect(t).toContain("A transcrição não cita valores investidos");
    expect(t).not.toContain("2.");
    expect(publicoCaso(c).opcoes).toEqual([]);
  });
  it("faltando nome e perfil: lista numerada com as ações", () => {
    const c = caso("Lead: oi.", lead({ primeiro_nome: "Lead", perfil: "" }));
    const t = resumoDoCaso(c, []);
    expect(t).toContain("Para gerar os slides, preciso de:");
    expect(t).toContain("2. Diga o primeiro nome do lead");
    expect(t).toContain("3. Diga o perfil do lead");
  });
  it("sem transcrição: pede os arquivos", () => {
    expect(resumoDoCaso(casoAvulso(), [])).toBe("Falta a carteira do lead e a transcrição da R1. Anexe os arquivos ou cole o texto aqui.");
  });
});

describe("resumo: avisos do método logo após a leitura", () => {
  const analise = { total: 1000, n_ativos: 1, excedente_fgc: 0, excedente_fgc_a_validar: false } as never;
  it("citação ausente da transcrição aparece sem rascunho, com as pendências fixas", () => {
    const c = caso("Lead: quero aposentar.", lead({ frases_literais: ["isso nunca foi dito"] }));
    c.analise = analise;
    c.ativos = [];
    const t = resumoDoCaso(c, []);
    expect(t).toContain("Avisos do método:\n- Citação não encontrada literalmente na transcrição");
    expect(t).toContain("Pendências a validar antes da R2:\n- custo de não fazer nada");
    expect(publicoCaso(c).avisosMetodo).toHaveLength(1);
  });
  it("sem carteira (analise vazia) o bloco não aparece", () => {
    const c = caso("Lead: oi.", lead({ frases_literais: ["nunca dito"] }));
    const t = resumoDoCaso(c, []);
    expect(t).not.toContain("Avisos do método");
    expect(publicoCaso(c).pendenciasMetodo).toEqual([]);
  });
});
