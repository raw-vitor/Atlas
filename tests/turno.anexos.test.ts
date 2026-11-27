/** Lógica do turno com anexos e instruções: leitura de carteira e transcrição, reenvio, "usar a transcrição", formato recusado e cancelamento. */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const perguntar = vi.fn();
const chamadasChat: string[] = [];
let bloquearChat: Promise<never> | null = null;

vi.mock("@/lib/bedrock", async (orig) => {
  const real = await orig<typeof import("@/lib/bedrock")>();
  const fs = await import("node:fs");
  const path = await import("node:path");
  const canned = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/canned.json"), "utf-8"));
  const { canonico } = await import("@/lib/schemas");
  const ativoDerivado = { nome: "CDB", emissor: "a confirmar", classe: "Pós-fixado", subclasse: "Bancário com FGC", liquidez: "a confirmar", vencimento: "a confirmar", valor: 600000, fora_do_depara: false };
  return {
    ...real,
    perguntarJson: (...a: unknown[]) => perguntar(...a),
    // Só a entrada do prompt muda o que o canned devolve: AtivosOut da transcrição é a carteira derivada.
    criarChatJson: () => async (system: string, _u: string, schema: string) => {
      chamadasChat.push(schema);
      if (bloquearChat) await bloquearChat;
      const dados = schema === "AtivosOut" && system.includes("O LEAD diz ter hoje") ? { ativos: [ativoDerivado], data_posicao: "" } : canned[schema];
      return canonico(structuredClone(dados), schema as never);
    },
  };
});

import { CanceladoError, comCancelamento } from "../lib/cancelamento";
import { casoAvulso, hashTexto, prontidao, type Caso } from "../lib/caso";
import { novoUso } from "../lib/bedrock";
import { ErroDeTarefa } from "../lib/tarefas/execucao/erros";
import { rodarTurno } from "../lib/tarefas/execucao/logica-turno";

const fx = (n: string) => fs.readFileSync(path.join(__dirname, "fixtures", n));
const carteira = { nome: "carteira_elisandro.csv", buf: fx("carteira_elisandro.csv") };
const transcricao = { nome: "transcricao_elisandro.txt", buf: fx("transcricao_elisandro.txt") };
const semValores = { nome: "r1.txt", buf: fx("transcricao_sem_carteira.txt") };

async function turno(caso: Caso, texto: string, arquivos: { nome: string; buf: Buffer }[] = []) {
  const eventos: { evento: string; dados: Record<string, unknown> }[] = [];
  const r = await rodarTurno({ caso, texto, arquivos, uso: novoUso(), enviar: (evento, dados) => eventos.push({ evento, dados: dados as Record<string, unknown> }) });
  return { ...r, eventos, nomes: eventos.map((e) => e.evento) };
}

const instrucao = (o: Partial<{ usar_transcricao: boolean; pergunta: boolean }>) =>
  perguntar.mockResolvedValue({ usar_transcricao: false, primeiro_nome: "", perfil: "", objetivos: [], pergunta: false, ...o });

beforeEach(() => { perguntar.mockReset(); chamadasChat.length = 0; bloquearChat = null; });

describe("turno com anexos", () => {
  it("carteira e transcrição no mesmo envio: lê, calcula e deixa o caso pronto", async () => {
    perguntar.mockResolvedValue({ classificacoes: [] });
    const caso = casoAvulso();
    const t = await turno(caso, "segue o material, assessor Luiz", [carteira, transcricao]);
    expect(t.nomes).toEqual(["atividade", "atividade", "atividade", "texto", "caso"]);
    expect(t.eventos[0].dados).toEqual({ pct: 5, msg: "Lendo os arquivos" });
    expect(caso.fontes.map((f) => [f.nome, f.papel])).toEqual([["carteira_elisandro.csv", "carteira"], ["transcricao_elisandro.txt", "transcricao"]]);
    expect(caso.fontes.every((f) => f.texto.length > 20 && f.hash === hashTexto(f.texto))).toBe(true);
    expect(caso.assessor).toBe("Luiz");
    expect(caso.analise?.total).toBe(739668.62);
    expect(prontidao(caso).pronto).toBe(true);
    expect(t.texto).toContain("Li 2 arquivos");
    expect(chamadasChat.sort()).toEqual(["AtivosOut", "Lead"]);
    expect(caso.historico.map((m) => m.papel)).toEqual(["assessor", "atlas"]);
    expect(caso.historico[0].texto).toContain("(anexou: carteira_elisandro.csv, transcricao_elisandro.txt)");
    expect((t.eventos[t.eventos.length - 1].dados as { prontidao: { pronto: boolean } }).prontidao.pronto).toBe(true);
  });

  it("reenviar os mesmos arquivos não lê de novo e diz o que ignorou", async () => {
    perguntar.mockResolvedValue({ classificacoes: [] });
    const caso = casoAvulso();
    await turno(caso, "", [carteira, transcricao]);
    chamadasChat.length = 0;
    const t = await turno(caso, "", [carteira]);
    expect(chamadasChat).toEqual([]);
    expect(caso.fontes).toHaveLength(2);
    expect(t.texto).toContain("Não usei: carteira_elisandro.csv (já enviado nesta conversa)");
  });

  it("formato não suportado vira erro com mensagem para a tela, sem mexer no caso", async () => {
    const caso = casoAvulso();
    const antes = JSON.stringify(caso.fontes);
    await expect(turno(caso, "veja", [{ nome: "virus.exe", buf: Buffer.from("MZ") }])).rejects.toMatchObject({
      name: "ErroDeTarefa", message: expect.stringContaining("Formato não suportado"),
    });
    await expect(turno(caso, "veja", [{ nome: "x.exe", buf: Buffer.from("MZ") }])).rejects.toBeInstanceOf(ErroDeTarefa);
    expect(JSON.stringify(caso.fontes)).toBe(antes);
  });

  it("arquivo ilegível entre os anexos não derruba o envio: vai para 'Não usei'", async () => {
    perguntar.mockResolvedValue({ classificacoes: [] });
    const t = await turno(casoAvulso(), "", [transcricao, { nome: "vazio.txt", buf: Buffer.from("oi") }]);
    expect(t.texto).toContain("Não usei: vazio.txt (Não consegui extrair texto de vazio.txt");
  });

  it("só arquivo ilegível numa conversa vazia: a pergunta cita 'Não usei' uma única vez", async () => {
    perguntar.mockResolvedValue({ classificacoes: [] });
    const t = await turno(casoAvulso(), "", [{ nome: "vazio.txt", buf: Buffer.from("oi") }]);
    expect(t.texto).toContain("Falta a carteira e a transcrição da R1.");
    expect(t.texto?.match(/Não usei:/g)).toHaveLength(1);
  });
});

describe("turno: instruções", () => {
  it('"usar a transcrição" monta a carteira derivada e diz que é aproximada', async () => {
    perguntar.mockResolvedValue({ classificacoes: [] });
    const caso = casoAvulso();
    await turno(caso, "", [semValores]);
    expect(prontidao(caso).pronto).toBe(false);
    instrucao({ usar_transcricao: true });
    const t = await turno(caso, "usa a transcrição mesmo");
    expect(t.texto).toContain("Montei a carteira com o que o lead disse na R1: CDB");
    expect(caso.analise?.total).toBe(600000);
    expect(caso.fontes.some((f) => f.papel === "carteira" && f.origemPapel === "transcricao")).toBe(true);
    expect(t.nomes).toContain("atividade");
    expect(t.nomes.slice(-2)).toEqual(["texto", "caso"]);
  });

  it("ajuste de perfil entra no lead, na lista de edições e invalida o rascunho", async () => {
    perguntar.mockResolvedValue({ classificacoes: [] });
    const caso = casoAvulso();
    await turno(caso, "", [carteira, transcricao]);
    caso.rascunho = {} as never;
    caso.configVersoes = { lead: 2, rascunho: 2 };
    perguntar.mockResolvedValue({ usar_transcricao: false, primeiro_nome: "", perfil: "Arrojado", objetivos: [], pergunta: false });
    const t = await turno(caso, "ele é arrojado");
    expect(t.texto).toContain("Anotei no lead: perfil Arrojado.");
    expect(caso.lead?.perfil).toBe("Arrojado");
    expect(caso.rascunho).toBeUndefined();
    expect(caso.configVersoes).toEqual({ lead: 2 }); // a versão do rascunho descartado some; a do lead (extração com LLM) fica
    expect(caso.edicoes.map((e) => e.campo)).toEqual(["lead.perfil"]);
  });

  it("ajuste sem transcrição lida explica que não há onde anotar", async () => {
    perguntar.mockResolvedValue({ classificacoes: [] });
    const caso = casoAvulso();
    await turno(caso, "", [carteira]);
    perguntar.mockResolvedValue({ usar_transcricao: false, primeiro_nome: "Ana", perfil: "", objetivos: [], pergunta: false });
    const t = await turno(caso, "o lead é a Ana");
    expect(t.texto).toContain("Ainda não li a transcrição da R1");
    expect(caso.lead).toBeUndefined();
  });
});

describe("turno: cancelamento", () => {
  it("cancelar durante a leitura interrompe a chamada em andamento com CanceladoError", async () => {
    perguntar.mockResolvedValue({ classificacoes: [] });
    const ac = new AbortController();
    bloquearChat = new Promise<never>((_ok, falha) => ac.signal.addEventListener("abort", () => falha(new CanceladoError())));
    const caso = casoAvulso();
    const p = comCancelamento(ac.signal, () => turno(caso, "", [carteira, transcricao]));
    await vi.waitFor(() => expect(chamadasChat.length).toBeGreaterThan(0));
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(CanceladoError);
  });

  it("sinal já abortado não chega a ler os anexos", async () => {
    const ac = new AbortController(); ac.abort();
    await expect(comCancelamento(ac.signal, () => turno(casoAvulso(), "", [carteira, transcricao]))).rejects.toBeInstanceOf(CanceladoError);
    expect(chamadasChat).toEqual([]);
  });
});
