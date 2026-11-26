import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { interpretar } from "../lib/chat";

const fx = (n: string) => fs.readFileSync(path.join(__dirname, "fixtures", n));
const uso = { chamadas: 0, entrada: 0, saida: 0 };

describe("lote", () => {
  it("cópia e arquivo corrompido ficam em ignorados e não derrubam o envio", async () => {
    const it_ = await interpretar("R2 assessor Luiz", [
      { nome: "carteira_elisandro.csv", buf: fx("carteira_elisandro.csv") },
      { nome: "copia.csv", buf: fx("carteira_elisandro.csv") },
      { nome: "quebrado.docx", buf: Buffer.from("não é um docx") },
      { nome: "transcricao_elisandro.txt", buf: fx("transcricao_elisandro.txt") },
    ], uso);
    expect(it_.carteiras.map((a) => a.nome)).toEqual(["carteira_elisandro.csv"]);
    expect(it_.transcricoes.map((a) => a.nome)).toEqual(["transcricao_elisandro.txt"]);
    expect(it_.ignorados.some((x) => x.startsWith("copia.csv (cópia de carteira_elisandro.csv)"))).toBe(true);
    expect(it_.ignorados.some((x) => x.startsWith("quebrado.docx"))).toBe(true);
  });
});
