/** Fase 1/3: JSON do caso Elisandro (respostas do LLM gravadas) → deck-service → .pptx e .pdf. Pula se o serviço não estiver no ar. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { deckSaude } from "../lib/deck";
import { rodar } from "../lib/pipeline";
import { canonico, type SchemaName } from "../lib/schemas";

const fx = (n: string) => path.join(__dirname, "fixtures", n);
const canned = JSON.parse(fs.readFileSync(fx("canned.json"), "utf-8"));
const saude = await deckSaude();

describe.skipIf(!saude.ok)("deck-service (ponta a ponta sem LLM)", () => {
  it("gera pptx com 31 slides e pdf", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "atlas_it_"));
    const chat = async <T,>(_s: string, _u: string, schema: SchemaName) => canonico<T>(structuredClone(canned[schema]), schema);
    const uso = { chamadas: 0, entrada: 0, saida: 0 };
    const res = await rodar({
      carteiras: [{ nome: "carteira_elisandro.csv", buf: fs.readFileSync(fx("carteira_elisandro.csv")) }],
      transcricoes: [{ nome: "transcricao_elisandro.txt", buf: fs.readFileSync(fx("transcricao_elisandro.txt")) }],
      assessor: "Luiz", dataR2: new Date("2026-11-13T00:00:00Z"), outDir: out, formatos: ["pptx", "pdf"],
    }, chat, uso, () => {});
    expect(res.arquivos.pptx).toBe("Elisandro_R2_20261113_Luiz.pptx");
    expect(res.resumo.total).toBe(739668.62);
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(out, res.arquivos.pptx)));
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides.length).toBe(31);
    expect(fs.readFileSync(path.join(out, res.arquivos.pdf)).subarray(0, 4).toString()).toBe("%PDF");
  }, 240000);

  it("gera o deck sem frases literais e sem itens em 'disse'", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "atlas_it_"));
    const chat = async <T,>(_s: string, _u: string, schema: SchemaName) => {
      const d = structuredClone(canned[schema]);
      if (schema === "Lead") d.frases_literais = [];
      if (schema === "Diagnostico") d.disse = [];
      return canonico<T>(d, schema);
    };
    const uso = { chamadas: 0, entrada: 0, saida: 0 };
    const res = await rodar({
      carteiras: [{ nome: "carteira_elisandro.csv", buf: fs.readFileSync(fx("carteira_elisandro.csv")) }],
      transcricoes: [{ nome: "transcricao_elisandro.txt", buf: fs.readFileSync(fx("transcricao_elisandro.txt")) }],
      assessor: "Luiz", dataR2: new Date("2026-11-13T00:00:00Z"), outDir: out, formatos: ["pptx"],
    }, chat, uso, () => {});
    expect(fs.statSync(path.join(out, res.arquivos.pptx)).size).toBeGreaterThan(10_000);
  }, 240000);
});
