import { describe, expect, it } from "vitest";
import { interpretar, papeisDaMensagem } from "../lib/chat";
import { dataMaisRecente, juntarTranscricoes, unirCarteiras } from "../lib/pipeline";

const uso = { chamadas: 0, entrada: 0, saida: 0, maiorEntrada: 0 };
const b = (s: string) => Buffer.from(s);

const EXTRATO_XP = `POSICAO CONSOLIDADA DE INVESTIMENTOS XP
Tesouro Selic 2029 (LFT) XP Titulo Publico 01/03/2029 D+1 320.000,00
CDB XP 103% CDI Bancario 15/07/2028 No venc. 450.000,00
LCI XP 97% CDI Bancario 20/02/2028 No venc. 380.000,00
Tesouro IPCA+ 2035 Juros Semestrais 15/05/2035 295.400,00
Debenture ELET26 Cred. Privado 210.000,00
PATRIMONIO TOTAL CONSOLIDADO 1.655.400,00
`;
const EXTRATO_BTG = EXTRATO_XP.replace(/XP/g, "BTG");
const falas = (n: string) => Array.from({ length: 14 }, (_, i) => (i % 2 ? "Ana" : "Luiz") + `: fala ${i} da parte ${n}, vamos conversar sobre o objetivo.`).join("\n");

describe("fontes por papel", () => {
  it("duas carteiras e duas partes de transcrição, em ordem de nome", async () => {
    const r = await interpretar("", [
      { nome: "r1_parte2.txt", buf: b(falas("2")) }, { nome: "extrato_xp.txt", buf: b(EXTRATO_XP) },
      { nome: "r1_parte10.txt", buf: b(falas("10")) }, { nome: "extrato_btg.txt", buf: b(EXTRATO_BTG) },
    ], uso);
    expect(r.pergunta).toBeUndefined();
    expect(r.carteiras.map((a) => a.nome).sort()).toEqual(["extrato_btg.txt", "extrato_xp.txt"]);
    expect(r.transcricoes.map((a) => a.nome)).toEqual(["r1_parte2.txt", "r1_parte10.txt"]);
  });

  it("extensão enganosa: extrato em .md e transcrição em .xlsx-like nome seguem o conteúdo", async () => {
    const r = await interpretar("", [
      { nome: "notas.md", buf: b(EXTRATO_XP) }, { nome: "dados.txt", buf: b(falas("1")) },
    ], uso);
    expect(r.carteiras.map((a) => a.nome)).toEqual(["notas.md"]);
    expect(r.transcricoes.map((a) => a.nome)).toEqual(["dados.txt"]);
  });

  it("carteira colada na mensagem vira fonte", async () => {
    const r = await interpretar(`assessor Luiz\n${EXTRATO_XP}`, [{ nome: "r1.txt", buf: b(falas("1")) }], uso);
    expect(r.carteiras.map((a) => a.nome)).toEqual(["texto da mensagem"]);
    expect(r.assessor).toBe("Luiz");
  });

  it("carteira digitada curta (2+ valores em R$) vira fonte; sem arquivos pergunta o que falta", async () => {
    const r = await interpretar("Tenho CDB XP 103% CDI 150.000,00 e LCI BTG 80.000,00", [], uso);
    expect(r.carteiras.map((a) => a.nome)).toEqual(["texto da mensagem"]);
    expect(r.pergunta).toMatch(/Falta a transcrição/);
  });

  it("instrução curta citando produto não vira carteira", async () => {
    const r = await interpretar("R2 do Elisandro, só CDB e LCI, assessor Luiz", [], uso);
    expect(r.carteiras).toHaveLength(0);
    expect(r.pergunta).toMatch(/digitar\/colar/);
    expect(r.pergunta).toMatch(/Anotei: assessor Luiz/);
    expect((await interpretar("oi", [], uso)).pergunta).toMatch(/^Olá! Sou o Atlas/);
  });

  it("mensagem longa que não é carteira nem transcrição segue só como instrução", async () => {
    const msg = "R2 do Elisandro, assessor Luiz. " + "Por favor, capriche. ".repeat(20);
    const r = await interpretar(msg, [{ nome: "r1.txt", buf: b(falas("1")) }, { nome: "extrato.txt", buf: b(EXTRATO_XP) }], uso);
    expect(r.carteiras.map((a) => a.nome)).toEqual(["extrato.txt"]);
  });

  it("papel declarado vence a máquina", async () => {
    const r = await interpretar("", [{ nome: "a.txt", buf: b(EXTRATO_XP) }, { nome: "b.txt", buf: b(falas("1")) }], uso, { "a.txt": "transcricao", "b.txt": "carteira" });
    expect(r.carteiras.map((a) => a.nome)).toEqual(["b.txt"]);
    expect(papeisDaMensagem("o extrato.pdf é a carteira e r1.docx é a transcrição", ["extrato.pdf", "r1.docx"]))
      .toEqual({ "extrato.pdf": "carteira", "r1.docx": "transcricao" });
  });

  it("papel faltando: diz o que falta e o que entendeu", async () => {
    const r = await interpretar("", [{ nome: "extrato_xp.txt", buf: b(EXTRATO_XP) }], uso);
    expect(r.pergunta).toMatch(/Falta a transcrição/);
    expect(r.pergunta).toMatch(/extrato_xp.txt = carteira/);
  });
});

describe("união de carteiras", () => {
  const at = (nome: string, valor: number) => ({ nome, emissor: "", classe: "Renda Fixa", subclasse: "", liquidez: "", vencimento: "", valor, fora_do_depara: false }) as never;
  it("mantém e soma ativos repetidos e marca duplicidade", () => {
    const u = unirCarteiras([
      { nome: "xp.pdf", ativos: [at("CDB Banco X", 100), at("LCI Y", 50)], data_posicao: "01/11/2026" },
      { nome: "btg.png", ativos: [at("cdb  banco x", 200)], data_posicao: "06/11/2026" },
    ]);
    expect(u.ativos).toHaveLength(3);
    expect(u.pendencias).toHaveLength(1);
    expect(u.pendencias[0]).toMatch(/duplicidade entre xp.pdf e btg.png/);
    expect(u.data_posicao).toBe("06/11/2026");
  });
  it("data mais recente entre formatos", () => {
    expect(dataMaisRecente(["2026-11-01", "05/11/2026", ""])).toBe("05/11/2026");
  });
});

describe("várias transcrições", () => {
  it("uma só vai sem cabeçalho; várias ganham cabeçalho; acima do limite usa a maior", () => {
    expect(juntarTranscricoes([{ nome: "a", texto: "x" }]).texto).toBe("x");
    expect(juntarTranscricoes([{ nome: "a", texto: "x" }, { nome: "b", texto: "y" }]).texto).toBe("--- transcrição: a ---\nx\n\n--- transcrição: b ---\ny");
    const g = juntarTranscricoes([{ nome: "a", texto: "x".repeat(150_000) }, { nome: "b", texto: "y".repeat(100_000) }]);
    expect(g.texto.length).toBe(150_000);
    expect(g.aviso).toMatch(/só a maior \(a\)/);
  });
});
