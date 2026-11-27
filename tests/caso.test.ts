import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { casoAvulso, hashTexto, prontidao, removerDerivada, transcricaoJunta } from "../lib/caso";
import { toText } from "../lib/ingest";
import { derivarCarteira, leitura, rascunho } from "../lib/pipeline";
import { canonico, type SchemaName } from "../lib/schemas";
import { checar } from "../lib/validate";

const fx = (n: string) => path.join(__dirname, "fixtures", n);
const esperado = JSON.parse(fs.readFileSync(fx("esperado.json"), "utf-8"));
const canned = JSON.parse(fs.readFileSync(fx("canned.json"), "utf-8"));

async function montar() {
  const chamadas: string[] = [];
  const chat = async <T,>(_s: string, _u: string, schema: SchemaName) => { chamadas.push(schema); return canonico<T>(structuredClone(canned[schema]), schema); };
  const caso = casoAvulso();
  const cart = await toText("carteira_elisandro.csv", fs.readFileSync(fx("carteira_elisandro.csv")));
  const tr = await toText("transcricao_elisandro.txt", fs.readFileSync(fx("transcricao_elisandro.txt")));
  caso.fontes = [
    { nome: "carteira_elisandro.csv", papel: "carteira", origemPapel: "usuario", texto: cart, hash: hashTexto(cart) },
    { nome: "transcricao_elisandro.txt", papel: "transcricao", origemPapel: "usuario", texto: tr, hash: hashTexto(tr) },
  ];
  return { caso, chat, chamadas };
}
const sem = () => {};

describe("caso: Leitura e Rascunho separados", () => {
  it("sem fontes, não está pronto", () => {
    const p = prontidao(casoAvulso());
    expect(p.pronto).toBe(false);
    expect(p.faltas.length).toBe(4);
  });

  it("Leitura calcula análise e lead e deixa o caso pronto; não gera rascunho", async () => {
    const { caso, chat, chamadas } = await montar();
    await leitura(caso, chat, sem);
    expect(chamadas.sort()).toEqual(["AtivosOut", "Lead"]);
    expect(caso.analise?.total).toBe(739668.62);
    expect(caso.rascunho).toBeUndefined();
    expect(prontidao(caso).pronto).toBe(true);
  });

  it("Leitura repetida sem fonte nova não chama o LLM", async () => {
    const { caso, chat, chamadas } = await montar();
    await leitura(caso, chat, sem);
    chamadas.length = 0;
    await leitura(caso, chat, sem);
    expect(chamadas).toEqual([]);
  });

  it("Leitura + Rascunho dão os mesmos avisos e pendências de antes da divisão", async () => {
    const { caso, chat, chamadas } = await montar();
    caso.dataR2 = "2026-11-13";
    await leitura(caso, chat, sem);
    await rascunho(caso, chat, sem);
    expect(chamadas.length).toBe(6);
    // Os avisos divergem de propósito do Python (tests/paridade.test.ts); aqui vale serem os mesmos de checar() direto.
    const r = caso.rascunho!;
    const [avisos] = checar(caso.lead!, caso.ativos, caso.analise!, r.aloc, r.diag, r.dec, r.notas, transcricaoJunta(caso).texto);
    expect(r.avisos).toEqual(avisos);
    expect(r.avisos.length).toBeGreaterThan(0);
    expect(r.pendencias).toEqual(esperado.pendencias);
  });

  it("fonte nova invalida o rascunho", async () => {
    const { caso, chat } = await montar();
    await leitura(caso, chat, sem);
    await rascunho(caso, chat, sem);
    const t = "Data 2\nCliente: outra conversa.";
    caso.fontes.push({ nome: "t2.txt", papel: "transcricao", origemPapel: "usuario", texto: t, hash: hashTexto(t) });
    await leitura(caso, chat, sem);
    expect(caso.rascunho).toBeUndefined();
  });
});

describe("carteira derivada da transcrição", () => {
  const trSem = fs.readFileSync(fx("transcricao_sem_carteira.txt"), "utf-8");
  const ativoDerivado = { nome: "CDB", emissor: "a confirmar", classe: "Pós-fixado", subclasse: "Bancário com FGC", liquidez: "a confirmar", vencimento: "a confirmar", valor: 600000, fora_do_depara: false };
  async function soTranscricao() {
    const chamadas: string[] = [];
    const chat = async <T,>(_s: string, _u: string, schema: SchemaName) => {
      chamadas.push(schema);
      return canonico<T>(structuredClone(schema === "AtivosOut" ? { ativos: [ativoDerivado], data_posicao: "" } : canned[schema]), schema);
    };
    const caso = casoAvulso();
    caso.fontes = [{ nome: "r1.txt", papel: "transcricao", origemPapel: "usuario", texto: trSem, hash: hashTexto(trSem) }];
    await leitura(caso, chat, sem);
    return { caso, chat, chamadas };
  }

  it("deriva a carteira sem ler como extrato e deixa o caso pronto, com pendência", async () => {
    const { caso, chat, chamadas } = await soTranscricao();
    expect(prontidao(caso).pronto).toBe(false);
    chamadas.length = 0;
    const ativos = await derivarCarteira(caso, chat, sem);
    expect(ativos).toHaveLength(1);
    expect(chamadas).toEqual(["AtivosOut"]); // só a derivação; leitura não extrai de novo
    expect(caso.analise?.total).toBe(600000);
    expect(caso.pendenciasCarteira.join(" ")).toContain("valores que o lead citou");
    expect(prontidao(caso).pronto).toBe(true);
  });

  it("carteira real depois: a derivada sai e o total é o da carteira real", async () => {
    const { caso, chat } = await soTranscricao();
    await derivarCarteira(caso, chat, sem);
    const cart = await toText("carteira_elisandro.csv", fs.readFileSync(fx("carteira_elisandro.csv")));
    expect(removerDerivada(caso)).toBe(true);
    caso.fontes.push({ nome: "carteira_elisandro.csv", papel: "carteira", origemPapel: "usuario", texto: cart, hash: hashTexto(cart) });
    const chatReal = async <T,>(_s: string, _u: string, schema: SchemaName) => canonico<T>(structuredClone(canned[schema]), schema);
    await leitura(caso, chatReal, sem);
    expect(caso.analise?.total).toBe(739668.62);
    expect(caso.pendenciasCarteira).toEqual([]);
  });

  it("lista vazia do LLM não cria fonte", async () => {
    const { caso } = await soTranscricao();
    const vazio = async <T,>() => ({ ativos: [], data_posicao: "" }) as T;
    expect(await derivarCarteira(caso, vazio, sem)).toEqual([]);
    expect(caso.fontes.some((f) => f.papel === "carteira")).toBe(false);
  });

  it("primeiro_nome \"Lead\" vira vazio e entra nas faltas", async () => {
    const { caso } = await soTranscricao(); // canned.Lead.primeiro_nome é "Elisandro"; força o rótulo
    const chat = async <T,>(_s: string, _u: string, schema: SchemaName) =>
      canonico<T>(structuredClone(schema === "Lead" ? { ...canned.Lead, primeiro_nome: "Lead" } : canned[schema]), schema);
    caso.leadHash = undefined;
    await leitura(caso, chat, sem);
    expect(caso.lead?.primeiro_nome).toBe("");
    expect(prontidao(caso).faltas).toContain("Primeiro nome do lead");
  });
});

