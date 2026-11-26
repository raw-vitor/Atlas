/** Os JSON em lib/schemas precisam ser o que app/schemas.py gera hoje. Se falhar: ../.venv/bin/python ../deck-service/export_schemas.py */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import constantes from "../lib/schemas/constantes.json";

const raiz = path.resolve(__dirname, "../..");
const py = path.join(raiz, ".venv/bin/python");

describe.skipIf(!fs.existsSync(py))("schemas Python × JSON do Atlas", () => {
  const gerado = JSON.parse(execFileSync(py, ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(raiz)})
from app import schemas
print(json.dumps({"docs": {n: getattr(schemas, n).model_json_schema() for n in schemas.SCHEMAS_EXPORTADOS},
                  "hash": schemas.schema_hash(), "classes": schemas.CLASSES, "modelo": schemas.MODELO}))
`], { encoding: "utf-8" }));

  for (const nome of Object.keys(gerado.docs)) {
    it(`${nome}.json bate com o Python`, () => {
      const arq = JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/schemas", `${nome}.json`), "utf-8"));
      expect(arq).toEqual(gerado.docs[nome]);
    });
  }
  it("constantes.json bate com o Python", () => {
    expect(constantes.SCHEMA_HASH).toBe(gerado.hash);
    expect(constantes.CLASSES).toEqual(gerado.classes);
    expect(constantes.MODELO).toEqual(gerado.modelo);
  });
});
