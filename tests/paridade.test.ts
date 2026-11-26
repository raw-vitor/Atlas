/** Paridade com o Python: prompts, cálculos e validação precisam sair idênticos, caractere por caractere.
 *  Regerar a referência: (raiz) .venv/bin/python tests/parity_dump.py */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as calc from "../lib/calc";
import * as steps from "../lib/steps";
import { toText } from "../lib/ingest";
import { canonico, type SchemaName } from "../lib/schemas";
import { checar } from "../lib/validate";
import type { Analise } from "../lib/types";

const fx = (n: string) => path.join(__dirname, "fixtures", n);
const esperado = JSON.parse(fs.readFileSync(fx("esperado.json"), "utf-8"));
const canned = JSON.parse(fs.readFileSync(fx("canned.json"), "utf-8"));

async function rodar() {
  const calls: { system: string; user: string; schema: string; temperature: number }[] = [];
  const chat = async <T,>(system: string, user: string, schema: SchemaName, temperature: number) => {
    calls.push({ system, user, schema, temperature });
    return canonico<T>(structuredClone(canned[schema]), schema);
  };
  const cart = await toText("carteira_elisandro.csv", fs.readFileSync(fx("carteira_elisandro.csv")));
  const tr = await toText("transcricao_elisandro.txt", fs.readFileSync(fx("transcricao_elisandro.txt")));
  const ao = await steps.extrairAtivos(cart, chat);
  const lead = await steps.extrairLead(tr, chat);
  const an = calc.analisar(ao.ativos);
  const aloc = await steps.proporAlocacao(lead, an, chat);
  const diag = await steps.diagnosticar(lead, an, aloc, chat);
  const [dec, notas] = await steps.fechar(lead, an, aloc, diag, { data_r2: "2026-11-13" }, chat);
  const [avisos, pend] = checar(lead, ao.ativos, an, aloc, diag, dec, notas, tr);
  return { calls, ao, lead, an, aloc, avisos, pend };
}

describe("paridade com o Python", () => {
  it("prompts (system + user) idênticos em todas as chamadas", async () => {
    const r = await rodar();
    expect(r.calls.map((c) => c.schema)).toEqual(esperado.calls.map((c: { schema: string }) => c.schema));
    r.calls.forEach((c, i) => {
      const e = esperado.calls[i];
      expect(c.temperature, `temperatura ${c.schema}`).toBe(e.temperature);
      expect(c.system, `system ${c.schema}`).toBe(e.system);
      expect(c.user, `user ${c.schema}`).toBe(e.user);
    });
  });

  it("analisar() e fatos_para_prompt()", async () => {
    const r = await rodar();
    expect(r.an).toEqual(esperado.analise as Analise);
    expect(calc.fatosParaPrompt(r.an, r.lead.perfil)).toEqual(esperado.fatos);
  });

  it("normalizar_alvo() e dedupe da alocação", async () => {
    const r = await rodar();
    expect([{ a: 50.4, b: 30.3, c: 19.3 }, { a: 33.3, b: 33.3, c: 33.4 }, { a: 1, b: 1, c: 1 }].map(calc.normalizarAlvo)).toEqual(esperado.normalizar);
    expect(r.aloc.classes.map((c) => c.pct_proposto)).toEqual(esperado.alocacao_pct);
  });

  it("checar(): avisos e pendências", async () => {
    const r = await rodar();
    expect(r.avisos).toEqual(esperado.avisos);
    expect(r.pend).toEqual(esperado.pendencias);
  });

  it("formatação brl/mil/pct", () => {
    expect([calc.brl(1234567.891, true), calc.brl(0.5), calc.brl(2.5), calc.brl(-1500)]).toEqual(esperado.fmt.brl);
    expect([296000, 1234567, 999, 2500, 3500, 1_000_000].map(calc.mil)).toEqual(esperado.fmt.mil);
    expect([calc.pct(12.345, 1), calc.pct(0.5), calc.pct(2.5), calc.pct(100)]).toEqual(esperado.fmt.pct);
  });

  it("total do caso Elisandro", async () => {
    const r = await rodar();
    expect(r.an.total).toBe(739668.62);
  });
});
