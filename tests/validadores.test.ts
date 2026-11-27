import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { kb } from "../lib/knowledge";
import { CONHECIMENTO } from "../lib/knowledge.gerado";
import { SCHEMAS, validar, type SchemaName } from "../lib/schemas";

describe("validar() com validadores gerados", () => {
  for (const nome of Object.keys(SCHEMAS) as SchemaName[]) {
    it(`${nome}: rejeita o que não é objeto, com erro legível`, () => {
      const erros = validar(nome, "texto");
      expect(erros.length).toBe(1);
      expect(erros[0]).toBe("/ must be object");
    });
    it(`${nome}: rejeita objeto sem os campos obrigatórios`, () => {
      const exigidos = (SCHEMAS[nome] as { required?: string[] }).required ?? [];
      expect(exigidos.length).toBeGreaterThan(0);
      expect(validar(nome, {})[0]).toMatch(/must have required property/);
    });
  }

  it("AtivosOut: válido e inválido", () => {
    expect(validar("AtivosOut", { ativos: [], data_posicao: "" })).toEqual([]);
    const erros = validar("AtivosOut", { ativos: "x", data_posicao: "" });
    expect(erros[0]).toBe("/ativos must be array");
  });

  it("validadores gerados não usam new Function nem eval", () => {
    const src = fs.readFileSync(path.join(__dirname, "../lib/validadores.gerado.js"), "utf-8");
    expect(src).not.toMatch(/new Function|\beval\(|\brequire\(/);
  });
});

describe("kb() com o mapa gerado", () => {
  it("prefixo desconhecido devolve vazio", () => {
    expect(kb("zz")).toBe("");
    expect(kb("toString")).toBe("");
  });
  it("concatena os prefixos presentes com o separador, ignorando os ausentes", () => {
    const [a, b] = Object.keys(CONHECIMENTO);
    if (!a || !b) return; // base ausente neste ambiente: o mapa vazio já é coberto acima
    expect(kb(a, "zz", b)).toBe(CONHECIMENTO[a] + "\n\n=====\n\n" + CONHECIMENTO[b]);
    expect(kb(a)).toBe(CONHECIMENTO[a]);
  });
});
