import { beforeEach, describe, expect, it, vi } from "vitest";

const perguntar = vi.fn();
vi.mock("../lib/bedrock", () => ({ perguntarJson: (...a: unknown[]) => perguntar(...a) }));

import { aplicarAjustes, casoAvulso, hashTexto, prontidao } from "../lib/caso";
import { interpretarInstrucao } from "../lib/instrucao";
import type { Lead } from "../lib/types";

const uso = { chamadas: 0, entrada: 0, saida: 0 };
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
    perguntar.mockResolvedValue({ usar_transcricao: true, primeiro_nome: " Carlos ", perfil: "Moderado", objetivos: ["", "Faculdade da filha"] });
    const r = await interpretarInstrucao("o lead é o Carlos, moderado, usa a transcrição", caso(), uso);
    expect(r).toEqual({ usarTranscricao: true, ajustes: { primeiro_nome: "Carlos", perfil: "Moderado", objetivos: ["Faculdade da filha"] } });
    expect(perguntar.mock.calls[0][1]).toContain("Primeiro nome do lead");
  });

  it("perfil fora da lista é descartado", async () => {
    perguntar.mockResolvedValue({ usar_transcricao: false, primeiro_nome: "", perfil: "Agressivo", objetivos: [] });
    expect(await interpretarInstrucao("x", caso(), uso)).toEqual({ usarTranscricao: false, ajustes: {} });
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
