/**
 * Os schemas vêm de app/schemas.py (deck-service/export_schemas.py). Não reescreva à mão.
 * - schema completo: valida a resposta (validadores do Ajv gerados em build por scripts/gerar-validadores.mjs, sem new Function)
 * - schema reduzido: enviado ao Bedrock, sem restrições de tamanho que o structured output não aceita
 */
import * as validadores from "./validadores.gerado";
import AtivosOutS from "./schemas/AtivosOut.json";
import LeadS from "./schemas/Lead.json";
import AlocacaoS from "./schemas/Alocacao.json";
import DiagnosticoS from "./schemas/Diagnostico.json";
import DecisaoS from "./schemas/Decisao.json";
import NotasS from "./schemas/Notas.json";
import constantes from "./schemas/constantes.json";

export const CLASSES: string[] = constantes.CLASSES;
export const MODELO: Record<string, number[]> = constantes.MODELO;

export type SchemaName = "AtivosOut" | "Lead" | "Alocacao" | "Diagnostico" | "Decisao" | "Notas";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
export const SCHEMAS: Record<SchemaName, Json> = {
  AtivosOut: AtivosOutS, Lead: LeadS, Alocacao: AlocacaoS, Diagnostico: DiagnosticoS, Decisao: DecisaoS, Notas: NotasS,
};

/** Valida contra o schema completo. Devolve a lista de erros (vazia se válido). */
export function validar(name: SchemaName, data: unknown): string[] {
  const v = validadores[name];
  return v(data) ? [] : (v.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
}

const RESTRICOES = ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum",
  "exclusiveMaximum", "multipleOf", "pattern", "uniqueItems", "minProperties", "maxProperties", "format"];

function reduzir(node: Json): Json {
  if (Array.isArray(node)) return node.map(reduzir);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if (RESTRICOES.includes(k)) continue;
    out[k] = k === "properties" || k === "$defs"
      ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, reduzir(pv)]))
      : reduzir(v);
  }
  if (out.type === "object" && out.properties) out.additionalProperties = false;
  return out;
}
const cacheReduzido = new Map<SchemaName, Json>();
export function schemaReduzido(name: SchemaName): Json {
  let s = cacheReduzido.get(name);
  if (!s) { s = reduzir(SCHEMAS[name]); cacheReduzido.set(name, s); }
  return s;
}

function resolver(schema: Json, root: Json): Json {
  let s = schema;
  while (s && s.$ref) s = root.$defs[String(s.$ref).split("/").pop() as string];
  if (s?.anyOf) s = s.anyOf.find((x: Json) => x.type !== "null") ?? s;
  return s;
}

/** Reordena as chaves na ordem do schema (a ordem do pydantic), descartando campos extras. */
export function canonico<T>(data: unknown, name: SchemaName): T {
  const root = SCHEMAS[name];
  const walk = (v: Json, sch: Json): Json => {
    const s = resolver(sch, root);
    if (Array.isArray(v)) return v.map((x) => walk(x, s?.items));
    if (v && typeof v === "object" && s?.properties) {
      const o: Json = {};
      for (const k of Object.keys(s.properties)) if (k in v) o[k] = walk(v[k], s.properties[k]);
      return o;
    }
    return v;
  };
  return walk(data, root) as T;
}

/** Equivalente a model_dump_json(indent=N) do pydantic (floats inteiros saem como 5000.0). */
export function dumpModel(data: unknown, name: SchemaName, indent?: number): string {
  const root = SCHEMAS[name];
  const num = (n: number, sch: Json) => (sch?.type === "number" && Number.isInteger(n) ? n.toFixed(1) : String(n));
  const emit = (v: Json, sch: Json, lvl: number): string => {
    const s = resolver(sch, root);
    const nl = indent === undefined ? "" : "\n" + " ".repeat(indent * (lvl + 1));
    const nlEnd = indent === undefined ? "" : "\n" + " ".repeat(indent * lvl);
    const sep = indent === undefined ? ":" : ": ";
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      return "[" + nl + v.map((x) => emit(x, s?.items, lvl + 1)).join("," + nl) + nlEnd + "]";
    }
    if (v && typeof v === "object") {
      const ks = Object.keys(v);
      if (!ks.length) return "{}";
      return "{" + nl + ks.map((k) => JSON.stringify(k) + sep + emit(v[k], s?.properties?.[k], lvl + 1)).join("," + nl) + nlEnd + "}";
    }
    if (typeof v === "number") return num(v, s);
    return JSON.stringify(v);
  };
  return emit(data, root, 0);
}
