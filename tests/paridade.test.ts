/** Paridade com o Python: prompts e cálculos precisam sair idênticos, caractere por caractere (a validação diverge, ver checar()).
 *  Regerar a referência: (raiz) .venv/bin/python tests/parity_dump.py */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as calc from "../lib/calc";
import * as steps from "../lib/steps";
import { toText } from "../lib/ingest";
import { canonico, type SchemaName } from "../lib/schemas";
import { checar, checarDados, checarRascunho } from "../lib/validate";
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
  return { calls, ao, lead, an, aloc, diag, dec, notas, tr, avisos, pend };
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

  // Os avisos divergem de propósito de app/validate.py (esperado.avisos): valor deduplicado com campo e trecho,
  // valores ditos pelo lead aceitos e norm() trocando pontuação por espaço. As pendências seguem iguais ao Python.
  it("checar(): avisos e pendências", async () => {
    const r = await rodar();
    expect(r.avisos.map((a) => a.texto)).toEqual([
      "'Para' de Pós-fixado cita emissor/produto: \"Pós-fixado · Bradesco · curto\".",
      "Inflação (IPCA+) desvia mais de 5 p.p. do modelo sem motivo escrito.",
      "Possível promessa de rentabilidade: \"Garanto\".",
      "Possível promessa de rentabilidade: \"vai render\".",
      "R$ 123.456 no slide O que você já faz bem (\"texto R$ 123.456 inventado\"): não está nos números calculados nem na fala do lead. Confira. Aparece em 3 trechos.",
      "R$ 479.000 no slide Riscos (\"R$ 479 mil\"): não está nos números calculados nem na fala do lead. Confira. Aparece em 6 trechos (slide Riscos; slide O primeiro ganho, número; slide A Decisão, número de hoje).",
      "Citação não encontrada literalmente na transcrição: \"frase que não existe na reunião xyz…\"",
    ]);
    expect(r.pend).toEqual(esperado.pendencias);
  });

  it("checar() = checarRascunho() + checarDados(), na ordem atual", async () => {
    const r = await rodar();
    const [avD, pendD] = checarDados(r.lead, r.ao.ativos, r.an, r.tr);
    expect([...checarRascunho(r.lead, r.ao.ativos, r.an, r.aloc, r.diag, r.dec, r.notas, r.tr), ...avD]).toEqual(r.avisos);
    expect(pendD).toEqual(r.pend);
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
