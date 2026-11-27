/** Lógica do turno (lib/tarefas/execucao/logica-turno.ts, o antigo POST de mensagens): perguntas sobre o caso vão para responderPergunta; texto não reconhecido não devolve o resumo de novo. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const perguntar = vi.fn();
const responder = vi.fn();
vi.mock("@/lib/bedrock", async (orig) => ({
  ...(await orig<typeof import("@/lib/bedrock")>()),
  perguntarJson: (...a: unknown[]) => perguntar(...a),
  criarChatJson: () => { throw new Error("criarChatJson não deveria ser chamado"); },
  novoUso: () => ({ chamadas: 0, entrada: 0, saida: 0, maiorEntrada: 0 }),
}));
vi.mock("@/lib/conversa", () => ({ responderPergunta: (...a: unknown[]) => responder(...a) }));

import { casoAvulso, hashTexto, type Caso } from "../lib/caso";
import { novoUso } from "../lib/bedrock";
import { rodarTurno } from "../lib/tarefas/execucao/logica-turno";
import type { Analise, Lead } from "../lib/types";

const TRANSCRICAO = "Assessor: e a retirada?\nAna: preciso de 10 mil por mês para viver.";
const lead: Lead = { primeiro_nome: "Ana", situacao: [], objetivos: ["Retirada de R$ 10 mil por mês"], restricoes: [], frases_literais: [],
  perfil: "Conservador", freio_principal: "", aporte_mensal: 0, meta_patrimonio_citada: "", lacunas: [] };

/** Caso pronto para gerar: transcrição lida, lead completo e carteira com total. */
function casoAberto(): Caso {
  const c = casoAvulso();
  c.fontes = [{ nome: "r1.txt", papel: "transcricao", origemPapel: "usuario", texto: TRANSCRICAO, hash: hashTexto(TRANSCRICAO) }];
  c.lead = { ...lead };
  c.analise = { total: 1_164_342.84, n_ativos: 10, por_classe: {}, pct_classe: {}, subclasses: {} } as unknown as Analise;
  return c;
}

const instrucao = (o: Partial<{ usar_transcricao: boolean; primeiro_nome: string; perfil: string; objetivos: string[]; pergunta: boolean }>) =>
  perguntar.mockResolvedValue({ usar_transcricao: false, primeiro_nome: "", perfil: "", objetivos: [], pergunta: false, ...o });

/** Roda o turno e devolve os eventos emitidos, na ordem. */
async function mandar(caso: Caso, msg: string, arquivos: { nome: string; texto: string }[] = []) {
  const eventos: { evento: string; dados: Record<string, unknown> }[] = [];
  const r = await rodarTurno({
    caso, texto: msg, arquivos: arquivos.map((a) => ({ nome: a.nome, buf: Buffer.from(a.texto) })), uso: novoUso(),
    enviar: (evento, dados) => eventos.push({ evento, dados: dados as Record<string, unknown> }),
  });
  const textos = eventos.filter((e) => e.evento === "texto").map((e) => String(e.dados.texto));
  expect(textos).toEqual([r.texto]);
  return { eventos, textos, nomes: eventos.map((e) => e.evento) };
}

describe("turno: perguntas e mensagens não reconhecidas", () => {
  beforeEach(() => { perguntar.mockReset(); responder.mockReset(); });

  it("pergunta num caso com fontes vai para responderPergunta e não devolve o resumo", async () => {
    instrucao({ pergunta: true });
    responder.mockResolvedValue("O R$ 10 mil é a retirada mensal que a Ana citou na R1.");
    const caso = casoAberto();
    const antes = JSON.stringify({ lead: caso.lead, fontes: caso.fontes });
    const { textos, nomes } = await mandar(caso, "por que o 10 mil não bate?");
    expect(responder).toHaveBeenCalledTimes(1);
    expect(responder.mock.calls[0][0]).toBe(caso);
    expect(responder.mock.calls[0][1]).toBe("por que o 10 mil não bate?");
    expect(textos).toEqual(["O R$ 10 mil é a retirada mensal que a Ana citou na R1."]);
    expect(nomes).toEqual(["atividade", "texto", "caso"]);
    expect(JSON.stringify({ lead: caso.lead, fontes: caso.fontes })).toBe(antes);
  });

  it("guarda no histórico a mensagem do assessor e a resposta do Atlas", async () => {
    instrucao({ pergunta: true });
    responder.mockResolvedValue("Ela tem R$ 450 mil em CDB.");
    const caso = casoAberto();
    await mandar(caso, "quanto ela tem em CDB?");
    expect(caso.historico.map((m) => [m.papel, m.texto])).toEqual([["assessor", "quanto ela tem em CDB?"], ["atlas", "Ela tem R$ 450 mil em CDB."]]);
  });

  it("mensagem não reconhecida devolve o que dá para pedir, não o resumo", async () => {
    instrucao({});
    const caso = casoAberto();
    const { textos } = await mandar(caso, "hmm, e aí?");
    expect(responder).not.toHaveBeenCalled();
    expect(textos).toHaveLength(1);
    expect(textos[0]).toContain("Não entendi o pedido.");
    expect(textos[0]).not.toContain("Pronto para gerar os slides");
    expect(textos[0]).not.toContain("ainda falta");
    expect(caso.historico.map((m) => m.papel)).toEqual(["assessor", "atlas"]);
  });

  it("caso incompleto: a mensagem não reconhecida diz o que falta", async () => {
    instrucao({});
    const caso = casoAberto();
    caso.lead = { ...lead, perfil: "" };
    const { textos } = await mandar(caso, "hmm");
    expect(textos[0]).toContain("Não entendi o pedido.");
    expect(textos[0]).toContain("ainda falta: Perfil (Conservador, Moderado ou Arrojado)");
  });

  it("sem interpretação do LLM (null) também não repete o resumo", async () => {
    perguntar.mockResolvedValue(null);
    const { textos } = await mandar(casoAberto(), "e o resto?");
    expect(textos[0]).toContain("Não entendi o pedido.");
  });

  it("mensagem com ajuste continua no caminho de instrução, mesmo marcada como pergunta", async () => {
    instrucao({ perfil: "Moderado", pergunta: true });
    const caso = casoAberto();
    const { textos } = await mandar(caso, "pode colocar ela como moderada?");
    expect(responder).not.toHaveBeenCalled();
    expect(textos[0]).toContain("Anotei no lead: perfil Moderado.");
    expect(caso.lead?.perfil).toBe("Moderado");
  });

  it("erro em responderPergunta sobe para o ciclo, que restaura o caso e avisa o assessor", async () => {
    instrucao({ pergunta: true });
    responder.mockRejectedValue(new Error("falhou"));
    await expect(mandar(casoAberto(), "por que?")).rejects.toThrow("falhou");
  });

  it("só arquivo repetido continua com o resumo", async () => {
    const caso = casoAberto();
    const { textos } = await mandar(caso, "", [{ nome: "r1.txt", texto: TRANSCRICAO }]);
    expect(perguntar).not.toHaveBeenCalled();
    expect(textos[0]).toContain("Pronto para gerar os slides");
    expect(textos[0]).toContain("Não usei: r1.txt (já enviado nesta conversa)");
    expect(caso.historico[0]).toMatchObject({ papel: "assessor", texto: "(anexou: r1.txt)" });
  });

  it("mensagem que só informa o assessor continua com o resumo", async () => {
    instrucao({});
    const { textos } = await mandar(casoAberto(), "assessor: João Silva");
    expect(textos[0]).not.toContain("Não entendi o pedido.");
    expect(textos[0]).toContain("Pronto para gerar os slides");
  });

  it("conversa sem fontes continua com a mensagem de boas-vindas", async () => {
    const caso = casoAvulso();
    const { textos } = await mandar(caso, "oi");
    expect(perguntar).not.toHaveBeenCalled();
    expect(textos[0]).toContain("Para começar, envie a carteira do lead e a transcrição da R1.");
  });
});
