import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { casoAvulso, hashTexto, prontidao } from "../lib/caso";
import { interpretar } from "../lib/chat";
import { avisosDePapel, leitura } from "../lib/pipeline";
import { canonico, type SchemaName } from "../lib/schemas";

const fx = (n: string) => path.join(__dirname, "fixtures", n);
const canned = JSON.parse(fs.readFileSync(fx("canned.json"), "utf-8"));
const uso = { chamadas: 0, entrada: 0, saida: 0 };
const docx = fs.readFileSync(fx("transcricao_elisandro_docx.txt"), "utf8");
const extrato = fs.readFileSync(fx("carteira_elisandro.csv"));
const EXTRATO_TXT = `POSICAO CONSOLIDADA DE INVESTIMENTOS
ATIVO INSTITUICAO VENCIMENTO LIQUIDEZ VALOR (R$)
Tesouro Selic 2029 (LFT) BTG Pactual 01/03/2029 D+1 320.000,00
CDB BTG Pactual 103% CDI 15/07/2028 No venc. 450.000,00
LCI BTG Pactual 97% CDI 20/02/2028 No venc. 380.000,00
Tesouro IPCA+ 2035 BTG Pactual 15/05/2035 295.400,00
Debenture ELET26 BTG Pactual 210.000,00
CSHG Logistica FII HGLG11 D+2 168.300,00
PATRIMONIO TOTAL CONSOLIDADO EM REAIS 4.579.850,00
`;

describe("4.3 conteúdo contra nome", () => {
  it("transcrição .docx e extrato no mesmo envio: cada um no papel certo, sem aviso", async () => {
    const r = await interpretar("R2", [
      { nome: "Reunião com Luiz Eduardo (60).txt", buf: Buffer.from(docx) },
      { nome: "carteira_elisandro.csv", buf: extrato },
    ], uso);
    expect(r.transcricoes.map((a) => a.nome)).toEqual(["Reunião com Luiz Eduardo (60).txt"]);
    expect(r.carteiras.map((a) => a.nome)).toEqual(["carteira_elisandro.csv"]);
    expect(r.avisos).toEqual([]);
  });

  it("avisa quando o conteúdo manda no sentido contrário ao nome", async () => {
    const r = await interpretar("R2", [
      { nome: "Extrato Bradesco.txt", buf: Buffer.from(docx) },
      { nome: "carteira_elisandro.csv", buf: extrato },
    ], uso);
    expect(r.avisos.length).toBe(1);
    expect(r.avisos[0]).toContain('"Extrato Bradesco.txt" como transcrição');
    expect(r.avisos[0]).toContain("Extrato Bradesco.txt é a carteira");
  });

  it("papel declarado pelo assessor não gera aviso", async () => {
    const r = await interpretar("R2", [
      { nome: "Extrato Bradesco.txt", buf: Buffer.from(docx) },
      { nome: "carteira_elisandro.csv", buf: extrato },
    ], uso, { "Extrato Bradesco.txt": "transcricao" });
    expect(r.avisos).toEqual([]);
  });
});

describe("4.4 rede de segurança na leitura", () => {
  it("avisosDePapel: carteira que parece conversa e transcrição que parece extrato", () => {
    const a = avisosDePapel([{ nome: "x.txt", texto: docx, origemPapel: "automatico" }], []);
    expect(a[0]).toContain("parece uma transcrição");
    const b = avisosDePapel([], [{ nome: "y.csv", texto: EXTRATO_TXT, origemPapel: "automatico" }]);
    expect(b[0]).toContain("parece um extrato");
  });

  it("não avisa quando o assessor declarou o papel", () => {
    expect(avisosDePapel([{ nome: "x.txt", texto: docx, origemPapel: "usuario" }], [])).toEqual([]);
  });

  it("leitura registra o aviso em avisosLeitura", async () => {
    const chat = async <T,>(_s: string, _u: string, schema: SchemaName) => canonico<T>(structuredClone(canned[schema]), schema);
    const caso = casoAvulso();
    caso.fontes = [{ nome: "x.txt", papel: "carteira", origemPapel: "automatico", texto: docx, hash: hashTexto(docx) }];
    await leitura(caso, chat, () => {});
    expect(caso.avisosLeitura.some((a) => a.includes("parece uma transcrição"))).toBe(true);
  });

  it("leitura avisa de ativo sem valor, sem mexer no total", async () => {
    const chat = async <T,>(_s: string, _u: string, schema: SchemaName) => canonico<T>(structuredClone(canned[schema]), schema);
    const caso = casoAvulso();
    caso.fontes = [{ nome: "c.csv", papel: "carteira", origemPapel: "usuario", texto: "a;b", hash: "h", ativos: canned.AtivosOut.ativos, dataPosicao: "" }];
    await leitura(caso, chat, () => {});
    expect(caso.avisosLeitura.some((a) => a.includes('"PGBL Prev Itaú" veio sem valor'))).toBe(true);
    expect(caso.analise!.total).toBe(739668.62);
  });
});

describe("4.5 lead sem objetivo de verdade", () => {
  it('objetivo "a confirmar" não conta para a prontidão', async () => {
    const caso = casoAvulso();
    caso.lead = { ...canned.Lead, objetivos: ["Objetivos a confirmar — R1 não registrou fala do lead"] };
    caso.analise = { total: 1 } as never;
    expect(prontidao(caso).itens.find((i) => i.chave === "objetivo")!.ok).toBe(false);
    caso.lead = { ...canned.Lead, objetivos: ["Aposentar aos 60"] };
    expect(prontidao(caso).itens.find((i) => i.chave === "objetivo")!.ok).toBe(true);
  });
});
