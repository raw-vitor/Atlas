/** Jobs em memória com TTL. Os arquivos de saída ficam em WORK_DIR; as entradas nunca vão para o disco. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config";

export interface Evento { id: string; status: string; etapa: string; pct: number; msg: string; erro: string; resultado: Resultado | null }
export interface Resultado {
  arquivos: Record<string, string>;
  avisos: string[];
  pendencias: string[];
  resumo: { lead: string; total: number; perfil: string };
  tokens: { chamadas: number; entrada: number; saida: number };
}
export interface Job {
  id: string; dir: string; status: "na fila" | "rodando" | "pronto" | "erro"; etapa: string; pct: number; msg: string;
  erro: string; resultado: Resultado | null; criado: number; eventos: Evento[];
  ouvintes: Set<(e: Evento) => void>;
}
export type Progress = (etapa: string, pct: number, msg: string) => void;

const g = globalThis as unknown as { __atlasJobs?: Map<string, Job>; __atlasFila?: Promise<unknown> };
const jobs = (g.__atlasJobs ??= new Map<string, Job>());

export const publico = (j: Job): Evento => ({ id: j.id, status: j.status, etapa: j.etapa, pct: j.pct, msg: j.msg, erro: j.erro, resultado: j.resultado });

export function limpar() {
  const agora = Date.now();
  for (const [id, j] of jobs) {
    if (agora - j.criado > config.jobTtlMin * 60_000 && (j.status === "pronto" || j.status === "erro")) {
      fs.rmSync(j.dir, { recursive: true, force: true });
      jobs.delete(id);
    }
  }
}

export function novo(): Job {
  limpar();
  const id = crypto.randomBytes(8).toString("hex");
  const dir = path.join(config.workDir, id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const j: Job = { id, dir, status: "na fila", etapa: "", pct: 0, msg: "Na fila", erro: "", resultado: null, criado: Date.now(), eventos: [], ouvintes: new Set() };
  jobs.set(id, j);
  return j;
}

export const obter = (id: string) => jobs.get(id);

function emitir(j: Job) {
  const e = publico(j);
  j.eventos.push(e);
  for (const f of j.ouvintes) f(e);
}

/** Roda em segundo plano. Vários jobs rodam em paralelo (o Bedrock aceita); limite simples de 3 simultâneos. */
let ativos = 0;
const espera: (() => void)[] = [];
async function vaga() { if (ativos >= 3) await new Promise<void>((r) => espera.push(r)); ativos++; }
function liberar() { ativos--; espera.shift()?.(); }

export function submeter(j: Job, fn: (p: Progress) => Promise<Resultado>) {
  emitir(j);
  void (async () => {
    await vaga();
    j.status = "rodando";
    const progress: Progress = (etapa, pct, msg) => { j.etapa = etapa; j.pct = pct; j.msg = msg; emitir(j); };
    try {
      j.resultado = await fn(progress);
      j.status = "pronto";
    } catch (e) {
      j.status = "erro";
      j.erro = e instanceof Error ? e.message : String(e); // sem conteúdo do lead no log
      console.error(`[atlas] job ${j.id} falhou: ${j.erro.slice(0, 300)}`);
    } finally {
      liberar();
      emitir(j);
    }
  })();
}
