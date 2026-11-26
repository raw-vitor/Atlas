import { describe, expect, it } from "vitest";
import canned from "./fixtures/canned.json";
import { validar } from "../lib/schemas";
import { msgRetry } from "../lib/prompts";

describe("poucas frases literais", () => {
  it("Lead e Diagnostico aceitam menos de 3 itens, mas não mais que o máximo", () => {
    const lead = structuredClone(canned.Lead);
    lead.frases_literais = lead.frases_literais.slice(0, 1);
    expect(validar("Lead", lead)).toEqual([]);
    lead.frases_literais = [];
    expect(validar("Lead", lead)).toEqual([]);
    lead.frases_literais = ["a", "b", "c", "d", "e", "f"];
    expect(validar("Lead", lead)).not.toEqual([]);

    const diag = structuredClone(canned.Diagnostico);
    diag.disse = diag.disse.slice(0, 1);
    expect(validar("Diagnostico", diag)).toEqual([]);
  });

  it("a mensagem de retry leva o erro completo", () => {
    expect(msgRetry("TypeError: schema: /x must NOT have fewer than 3 items")).toContain("/x must NOT have fewer than 3 items");
  });
});
