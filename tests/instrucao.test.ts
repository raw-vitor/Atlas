import { beforeEach, describe, expect, it, vi } from "vitest";

const perguntar = vi.fn();
vi.mock("../lib/bedrock", () => ({ perguntarJson: (...a: unknown[]) => perguntar(...a) }));

import { aplicarAjustes, casoAvulso, hashTexto, prontidao } from "../lib/caso";
import { interpretarInstrucao } from "../lib/instrucao";
import type { Lead } from "../lib/types";

const uso = { chamadas: 0, entrada: 0, saida: 0, maiorEntrada: 0 };
const lead: Lead = { primeiro_nome: "", situacao: [], objetivos: ["Aposentar aos 60"], restricoes: [], frases_literais: [],
  perfil: "Conservador", freio_principal: "", aporte_mensal: 0, meta_patrimonio_citada: "", lacunas: [] };
const caso = () => {
  const c = casoAvulso();
  c.fontes = [{ nome: "r1.txt", papel: "transcricao", origemPapel: "usuario", texto: "Lead: oi", hash: hashTexto("Lead: oi") }];
  c.lead = lead;
  return c;
};

describe("interpretarInstrucao", () => {
  beforeEach(() => perguntar.mockReset());

  it("devolve só o que o LLM extraiu e informa a situação do caso no prompt", async () => {
    perguntar.mockResolvedValue({ usar_transcricao: true, primeiro_nome: " Carlos ", perfil: "Moderado", objetivos: ["", "Faculdade da filha"], pergunta: false });
    const r = await interpretarInstrucao("o lead é o Carlos, moderado, usa a transcrição", caso(), uso);
    expect(r).toEqual({ usarTranscricao: true, ajustes: { primeiro_nome: "Carlos", perfil: "Moderado", objetivos: ["Faculdade da filha"] }, pergunta: false });
    expect(perguntar.mock.calls[0][1]).toContain("Primeiro nome do lead");
  });

  it("perfil fora da lista é descartado", async () => {
    perguntar.mockResolvedValue({ usar_transcricao: false, primeiro_nome: "", perfil: "Agressivo", objetivos: [], pergunta: false });
    expect(await interpretarInstrucao("x", caso(), uso)).toEqual({ usarTranscricao: false, ajustes: {}, pergunta: false });
  });

  it("marca a pergunta sobre o caso e pede o campo no schema", async () => {
    perguntar.mockResolvedValue({ usar_transcricao: false, primeiro_nome: "", perfil: "", objetivos: [], pergunta: true });
    expect(await interpretarInstrucao("por que o 10 mil não bate?", caso(), uso)).toEqual({ usarTranscricao: false, ajustes: {}, pergunta: true });
    const schema = perguntar.mock.calls[0][2] as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toContain("pergunta");
    expect(schema.properties.pergunta).toEqual({ type: "boolean" });
    expect(perguntar.mock.calls[0][0]).toContain("- pergunta:");
  });

  it("pergunta ausente ou não booleana vale false", async () => {
    perguntar.mockResolvedValue({ usar_transcricao: false, primeiro_nome: "", perfil: "", objetivos: [], pergunta: "sim" });
    expect((await interpretarInstrucao("x", caso(), uso))?.pergunta).toBe(false);
  });

  it("resposta inválida do LLM devolve null (a mensagem segue o caminho normal)", async () => {
    perguntar.mockResolvedValue(null);
    expect(await interpretarInstrucao("x", caso(), uso)).toBeNull();
  });
});

describe("aplicarAjustes", () => {
  it("o nome informado tira a falta e objetivos não repetem", () => {
    const c = caso();
    expect(prontidao(c).faltas).toContain("Primeiro nome do lead");
    c.lead = aplicarAjustes(lead, { primeiro_nome: "Carlos", objetivos: ["aposentar aos 60", "Faculdade da filha"] });
    expect(c.lead.objetivos).toEqual(["Aposentar aos 60", "Faculdade da filha"]);
    expect(prontidao(c).faltas).not.toContain("Primeiro nome do lead");
  });
});
