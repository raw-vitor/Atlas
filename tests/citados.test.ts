import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { valoresCitados } from "../lib/citados";

const tr = fs.readFileSync(path.join(__dirname, "fixtures/transcricao_sem_carteira.txt"), "utf-8");

describe("valoresCitados", () => {
  it("acha o valor dito pelo lead com o contexto e ignora o do assessor", () => {
    expect(valoresCitados(tr)).toEqual(["R$ 600 mil concentrados em CDB"]);
  });
  it("aceita as formas de escrever o valor", () => {
    expect(valoresCitados("Lead: tenho 600 mil reais no banco")[0]).toMatch(/^600 mil reais no banco/);
    expect(valoresCitados("Lead: são R$ 1,2 milhão em fundos.")[0]).toBe("R$ 1,2 milhão em fundos");
    expect(valoresCitados("Lead: tenho R$ 600.000 parados")[0]).toBe("R$ 600.000 parados");
  });
  it("sem valor devolve lista vazia", () => {
    expect(valoresCitados("Lead: tenho 16 anos até a aposentadoria e uma filha de 16.")).toEqual([]);
    expect(valoresCitados("Assessor: pense em R$ 500 mil.")).toEqual([]);
  });
  it("devolve no máximo 3 trechos", () => {
    expect(valoresCitados("Lead: R$ 1 mil a. R$ 2 mil b. R$ 3 mil c. R$ 4 mil d.")).toHaveLength(3);
  });
});
