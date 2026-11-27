import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { casoAvulso, hashTexto, publicoCaso, rebaixarCarteirasSubstituiveis, temExtrato } from "../lib/caso";
import { interpretar } from "../lib/chat";
import { leitura } from "../lib/pipeline";
import { resumoDoCaso } from "../lib/resumo";
import { canonico, type SchemaName } from "../lib/schemas";
import { mensagemLead } from "../lib/steps";
import { amostra, papelDe, triarComLlm, type ClassLlm, type TriadorLlm } from "../lib/triagem-llm";

const fx = (n: string) => path.join(__dirname, "fixtures", n);
const canned = JSON.parse(fs.readFileSync(fx("canned.json"), "utf-8"));
const uso = { chamadas: 0, entrada: 0, saida: 0 };
const docx = fs.readFileSync(fx("transcricao_elisandro_docx.txt"));
const csv = fs.readFileSync(fx("carteira_elisandro.csv"));
const DECK = Buffer.from("Proposta preparada a partir da nossa conversa\nPreparado para Elisandro · Perfil Conservador\nObjetivos: aposentadoria aos 60\nCarteira consolidada: CDB DI R$ 739.668,62");

const c = (o: Partial<ClassLlm>): ClassLlm => ({ tipo: "outro", contem: [], data_referencia: "", confianca: 0.95, motivo: "teste", ...o });
/** Triador falso: decide pelo nome do arquivo. */
const fake = (por: Record<string, Partial<ClassLlm>>): TriadorLlm => async (itens) => itens.map((i) => (por[i.nome] ? c(por[i.nome]) : null));

describe("4.6 triagem por LLM", () => {
  it("papelDe: extrato, transcrição, deck com posição e anotações soltas", () => {
    expect(papelDe(c({ tipo: "extrato" }))).toBe("carteira");
    expect(papelDe(c({ tipo: "transcricao_r1" }))).toBe("transcricao");
    expect(papelDe(c({ tipo: "deck_anterior", contem: ["posicao_carteira", "dados_do_lead"] }))).toBe("carteira");
    expect(papelDe(c({ tipo: "anotacoes", contem: ["dados_do_lead"] }))).toBe("contexto");
    expect(papelDe(c({ tipo: "outro", contem: ["falas_do_lead"] }))).toBe("transcricao");
  });

  it("o LLM manda: arquivo com nome neutro vai para o papel certo e o detalhe fica registrado", async () => {
    const r = await interpretar("R2", [{ nome: "arquivo1.txt", buf: docx }, { nome: "arquivo2.csv", buf: csv }], uso, {},
      fake({ "arquivo1.txt": { tipo: "transcricao_r1", contem: ["falas_do_lead"] }, "arquivo2.csv": { tipo: "extrato", contem: ["posicao_carteira"], data_referencia: "06/11/2026" } }));
    expect(r.transcricoes.map((a) => a.nome)).toEqual(["arquivo1.txt"]);
    expect(r.carteiras.map((a) => a.nome)).toEqual(["arquivo2.csv"]);
    expect(r.detalhes["arquivo2.csv"]).toMatchObject({ tipo: "extrato", data: "06/11/2026", papel: "carteira" });
  });

  it("LLM contra a contagem: vale o LLM e não polui o chat com aviso", async () => {
    const r = await interpretar("R2", [{ nome: "arquivo1.txt", buf: docx }, { nome: "arquivo2.csv", buf: csv }], uso, {},
      fake({ "arquivo1.txt": { tipo: "extrato", contem: ["posicao_carteira"], motivo: "tem tabela" } }));
    expect(r.carteiras.map((a) => a.nome)).toContain("arquivo1.txt");
    expect(r.avisos.some((a) => a.includes("contagem de sinais"))).toBe(false);
  });

  it("confiança baixa do LLM é ignorada: fica a contagem", async () => {
    const r = await interpretar("R2", [{ nome: "arquivo1.txt", buf: docx }, { nome: "arquivo2.csv", buf: csv }], uso, {},
      fake({ "arquivo1.txt": { tipo: "extrato", contem: ["posicao_carteira"], confianca: 0.4 } }));
    expect(r.transcricoes.map((a) => a.nome)).toEqual(["arquivo1.txt"]);
    expect(r.detalhes).toEqual({});
  });

  it("LLM fora do ar (null): cai na contagem sem derrubar o envio", async () => {
    const r = await interpretar("R2", [{ nome: "arquivo1.txt", buf: docx }, { nome: "arquivo2.csv", buf: csv }], uso, {}, async () => null);
    expect(r.transcricoes.map((a) => a.nome)).toEqual(["arquivo1.txt"]);
    expect(r.carteiras.map((a) => a.nome)).toEqual(["arquivo2.csv"]);
  });

  it("papel declarado pelo assessor não passa pelo LLM", async () => {
    let enviados: string[] = [];
    const espia: TriadorLlm = async (itens) => { enviados = itens.map((i) => i.nome); return itens.map(() => null); };
    await interpretar("R2", [{ nome: "arquivo1.txt", buf: docx }, { nome: "arquivo2.csv", buf: csv }], uso, { "arquivo1.txt": "transcricao" }, espia);
    expect(enviados).toEqual(["arquivo2.csv"]);
  });

  it("deck anterior com extrato no lote vira contexto, sem somar à carteira", async () => {
    const r = await interpretar("R2", [{ nome: "R2 - Elisandro.txt", buf: DECK }, { nome: "arquivo1.txt", buf: docx }, { nome: "arquivo2.csv", buf: csv }], uso, {},
      fake({ "R2 - Elisandro.txt": { tipo: "deck_anterior", contem: ["posicao_carteira", "dados_do_lead"] }, "arquivo2.csv": { tipo: "extrato", contem: ["posicao_carteira"] } }));
    expect(r.carteiras.map((a) => a.nome)).toEqual(["arquivo2.csv"]);
    expect(r.contextos.map((a) => a.nome)).toEqual(["R2 - Elisandro.txt"]);
  });

  it("deck anterior sem extrato vira a carteira", async () => {
    const r = await interpretar("R2", [{ nome: "R2 - Elisandro.txt", buf: DECK }, { nome: "arquivo1.txt", buf: docx }], uso, {},
      fake({ "R2 - Elisandro.txt": { tipo: "deck_anterior", contem: ["posicao_carteira", "dados_do_lead"] } }));
    expect(r.carteiras.map((a) => a.nome)).toEqual(["R2 - Elisandro.txt"]);
    expect(r.contextos).toEqual([]);
  });

  it("triarComLlm desligado (ATLAS_TRIAGEM_LLM=0) devolve null sem chamar a rede", async () => {
    expect(await triarComLlm([{ nome: "a", texto: "x", dica: "" }])).toBeNull();
  });

  it("amostra: texto curto inteiro; longo com começo, meio e fim", () => {
    expect(amostra("abc")).toBe("abc");
    const longo = "A".repeat(2000) + "M".repeat(2000) + "Z".repeat(2000);
    const a = amostra(longo);
    expect(a.length).toBeLessThan(longo.length);
    expect(a.startsWith("A")).toBe(true); expect(a).toContain("M"); expect(a.endsWith("Z")).toBe(true);
  });
});

describe("4.6 contexto no lead e no caso", () => {
  it("mensagemLead: sem contexto é idêntica à de antes (paridade)", () => {
    expect(mensagemLead("fala")).toBe("TRANSCRIÇÃO:\nfala");
  });

  it("mensagemLead: contexto vem depois, rotulado, e respeita o limite", () => {
    const m = mensagemLead("fala", [{ nome: "deck.pptx", tipo: "deck_anterior", texto: "X".repeat(100) }], 54);
    expect(m).toContain("--- contexto: deck.pptx (deck_anterior), não são falas do lead ---");
    expect(m.endsWith("X".repeat(50))).toBe(true);
  });

  it("leitura manda o contexto ao extrator do lead e refaz o lead se o contexto mudar", async () => {
    const msgs: string[] = [];
    const chat = async <T,>(_s: string, u: string, schema: SchemaName) => { if (schema === "Lead") msgs.push(u); return canonico<T>(structuredClone(canned[schema]), schema); };
    const caso = casoAvulso();
    const tr = docx.toString("utf8"), ct = DECK.toString("utf8");
    caso.fontes = [
      { nome: "tr.txt", papel: "transcricao", origemPapel: "automatico", texto: tr, hash: hashTexto(tr) },
      { nome: "c.csv", papel: "carteira", origemPapel: "automatico", texto: "a;b", hash: "h1", ativos: canned.AtivosOut.ativos, dataPosicao: "" },
    ];
    await leitura(caso, chat, () => {});
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).not.toContain("--- contexto");
    caso.fontes.push({ nome: "deck.pptx", papel: "contexto", tipo: "deck_anterior", origemPapel: "automatico", texto: ct, hash: hashTexto(ct) });
    await leitura(caso, chat, () => {});
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toContain("--- contexto: deck.pptx (deck_anterior)");
  });

  it("rebaixarCarteirasSubstituiveis: extrato novo tira o deck anterior da carteira", () => {
    const caso = casoAvulso();
    caso.fontes = [
      { nome: "deck.pptx", papel: "carteira", tipo: "deck_anterior", origemPapel: "automatico", texto: "x", hash: "a", ativos: [], dataPosicao: "" },
      { nome: "ext.csv", papel: "carteira", tipo: "extrato", origemPapel: "automatico", texto: "y", hash: "b" },
    ];
    expect(temExtrato(caso)).toBe(true);
    expect(rebaixarCarteirasSubstituiveis(caso)).toEqual(["deck.pptx"]);
    expect(caso.fontes.map((f) => f.papel)).toEqual(["contexto", "carteira"]);
  });

  it("resumo e estado público mostram o que o Atlas entendeu", () => {
    const caso = casoAvulso();
    caso.fontes = [{ nome: "deck.pptx", papel: "contexto", tipo: "deck_anterior", origemPapel: "automatico", texto: "x", hash: "a" }];
    expect(resumoDoCaso(caso, ["deck.pptx"])).toContain("Li deck.pptx (deck anterior, usado como contexto do lead)");
    expect(publicoCaso(caso).fontes[0]).toMatchObject({ papel: "contexto", tipo: "deck_anterior" });
  });
});
