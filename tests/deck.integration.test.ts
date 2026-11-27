/** Fase 1/3: JSON do caso Elisandro (respostas do LLM gravadas) → deck-service → .pptx e .pdf. Pula se o serviço não estiver no ar. */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { deckSaude } from "../lib/deck";
import { casoAvulso, hashTexto } from "../lib/caso";
import { deck, leitura, rascunho } from "../lib/pipeline";
import { canonico, type SchemaName } from "../lib/schemas";

const fx = (n: string) => path.join(__dirname, "fixtures", n);
const canned = JSON.parse(fs.readFileSync(fx("canned.json"), "utf-8"));
const saude = await deckSaude();

/** Leitura + rascunho + deck com as respostas gravadas do LLM, como o consumidor da fila faz (sem fila, DO nem R2). */
async function gerar(formatos: ("pptx" | "pdf")[], ajustar: (schema: SchemaName, d: Record<string, unknown>) => void = () => {}) {
  const chat = async <T,>(_s: string, _u: string, schema: SchemaName) => {
    const d = structuredClone(canned[schema]);
    ajustar(schema, d);
    return canonico<T>(d, schema);
  };
  const uso = { chamadas: 0, entrada: 0, saida: 0, maiorEntrada: 0 };
  const caso = casoAvulso();
  caso.assessor = "Luiz"; caso.dataR2 = "2026-11-13";
  const fonte = (nome: string, papel: "carteira" | "transcricao") => {
    const texto = fs.readFileSync(fx(nome), "utf-8");
    return { nome, papel, origemPapel: "usuario", texto, hash: hashTexto(texto) };
  };
  caso.fontes = [fonte("carteira_elisandro.csv", "carteira"), fonte("transcricao_elisandro.txt", "transcricao")];
  await leitura(caso, chat, () => {});
  await rascunho(caso, chat, () => {}, 38, 85);
  return deck(caso, formatos, uso, () => {});
}

describe.skipIf(!saude.ok)("deck-service (ponta a ponta sem LLM)", () => {
  it("gera pptx com 31 slides e pdf", async () => {
    const res = await gerar(["pptx", "pdf"]);
    expect(res.resultado.arquivos.pptx).toBe("Elisandro_R2_20261113_Luiz.pptx");
    expect(res.resultado.resumo.total).toBe(739668.62);
    const zip = await JSZip.loadAsync(res.binarios.pptx!);
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides.length).toBe(31);
    expect(Buffer.from(res.binarios.pdf!).subarray(0, 4).toString()).toBe("%PDF");
  }, 240000);

  it("gera o deck sem frases literais e sem itens em 'disse'", async () => {
    const res = await gerar(["pptx"], (schema, d) => {
      if (schema === "Lead") d.frases_literais = [];
      if (schema === "Diagnostico") d.disse = [];
    });
    expect(res.binarios.pptx!.byteLength).toBeGreaterThan(10_000);
  }, 240000);
});
