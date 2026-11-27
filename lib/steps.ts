/** Porte de app/llm/steps.py. Cada etapa recebe fatos já calculados em código. */
import * as calc from "./calc";
import { canonico, dumpModel, type SchemaName } from "./schemas";
import { pyDumps } from "./pyfmt";
import { montarSistema } from "./prompt-montagem";
import type { ConfigPrompt } from "./prompt-tipos";
import type { Alocacao, Analise, AtivosOut, Decisao, Diagnostico, Lead, Notas } from "./types";

/** Chamada ao LLM com saída validada pelo schema. Trocável nos testes de paridade. */
export type ChatJson = <T>(system: string, user: string, schema: SchemaName, temperature: number) => Promise<T>;

const BLOCO = 150;

/** `config` é a personalização do assessor (lib/prompt-blocos.ts); sem ela o prompt é o original. */
export async function extrairAtivos(texto: string, chat: ChatJson, config?: ConfigPrompt): Promise<AtivosOut> {
  const system = montarSistema("ativos", config);
  const linhas = texto.split(/\r\n|\r|\n/);
  if (linhas.length && linhas[linhas.length - 1] === "") linhas.pop(); // splitlines() do Python
  const pedacos: { i: number; txt: string }[] = [];
  for (let i = 0; i < Math.max(linhas.length, 1); i += BLOCO) {
    const txt = linhas.slice(i, i + BLOCO).join("\n");
    if (txt.trim()) pedacos.push({ i, txt });
  }
  // blocos independentes entre si: em paralelo; a ordem do resultado é preservada
  const rs = await Promise.all(pedacos.map(({ i, txt }) =>
    chat<AtivosOut>(system, `Texto do arquivo (trecho ${i / BLOCO + 1}):\n${txt}`, "AtivosOut", 0.0)));
  const ativos = [];
  let data = "";
  for (const r of rs) {
    for (const a of r.ativos) {
      const n = a.nome.toLowerCase();
      if (n.includes("prev") && !["fechada", "efpc"].some((k) => n.includes(k))) a.fora_do_depara = false;
    }
    ativos.push(...r.ativos);
    data = data || r.data_posicao;
  }
  return { ativos, data_posicao: data };
}

/** Ativos que o lead cita na fala (valores aproximados). Uma chamada só, sem dividir em blocos. */
export function extrairAtivosDaTranscricao(transcricao: string, chat: ChatJson, config?: ConfigPrompt): Promise<AtivosOut> {
  return chat<AtivosOut>(montarSistema("ativos_transcricao", config), "TRANSCRIÇÃO:\n" + transcricao, "AtivosOut", 0.0);
}

export interface ContextoLead { nome: string; tipo: string; texto: string }

/** Contextos (deck anterior, anotações) vão depois da transcrição, rotulados: citações literais continuam só da fala do lead. */
export function mensagemLead(transcricao: string, contextos: ContextoLead[] = [], limite = 0): string {
  let msg = "TRANSCRIÇÃO:\n" + transcricao;
  const sobra = limite > 0 ? Math.max(0, limite - transcricao.length) : Infinity;
  const porArquivo = contextos.length ? Math.floor(sobra / contextos.length) : 0;
  for (const c of contextos)
    msg += `\n\n--- contexto: ${c.nome} (${c.tipo}), não são falas do lead ---\n${Number.isFinite(porArquivo) ? c.texto.slice(0, porArquivo) : c.texto}`;
  return msg;
}

export function extrairLead(transcricao: string, chat: ChatJson, contextos: ContextoLead[] = [], limite = 0, config?: ConfigPrompt): Promise<Lead> {
  return chat<Lead>(montarSistema("lead", config),
    mensagemLead(transcricao, contextos, limite), "Lead", 0.1);
}

export function ctx(lead: Lead, an: Analise): string {
  const fatos = calc.fatosParaPrompt(an, lead.perfil);
  return "LEAD:\n" + dumpModel(lead, "Lead", 1) + "\n\nFATOS (únicos números permitidos):\n- " + fatos.join("\n- ") +
    "\n\nMODELO DO PERFIL (%): " + pyDumps(calc.modeloDoPerfil(lead.perfil));
}

export async function proporAlocacao(lead: Lead, an: Analise, chat: ChatJson, config?: ConfigPrompt): Promise<Alocacao> {
  const r = await chat<Alocacao>(montarSistema("alocacao", config), ctx(lead, an), "Alocacao", 0.2);
  const alvo = calc.normalizarAlvo(Object.fromEntries(r.classes.map((c) => [c.classe, c.pct_proposto])));
  const seen = new Map<string, (typeof r.classes)[number]>();
  for (const c of r.classes) {
    if (!seen.has(c.classe)) { c.pct_proposto = alvo[c.classe]; seen.set(c.classe, c); }
  }
  r.classes = [...seen.values()];
  return r;
}

export function diagnosticar(lead: Lead, an: Analise, aloc: Alocacao, chat: ChatJson, config?: ConfigPrompt): Promise<Diagnostico> {
  const c = ctx(lead, an) + "\n\nPROPOSTA:\n" +
    aloc.classes.map((x) => `- ${x.classe}: ${Math.trunc(x.pct_proposto)}% (${x.para_detalhe})`).join("\n");
  return chat<Diagnostico>(montarSistema("diagnostico", config), c, "Diagnostico", 0.2);
}

export async function fechar(lead: Lead, an: Analise, aloc: Alocacao, diag: Diagnostico,
  datas: Record<string, string>, chat: ChatJson, config?: ConfigPrompt): Promise<[Decisao, Notas]> {
  const c = ctx(lead, an) + "\n\nPROPOSTA:\n" +
    aloc.classes.map((x) => `- ${x.classe}: ${Math.trunc(x.pct_proposto)}% fase ${x.fase}`).join("\n") +
    "\n\nDIAGNÓSTICO:\n" + dumpModel(diag, "Diagnostico", 1) + "\n\nDATAS:\n" + pyDumps(datas);
  const dec = await chat<Decisao>(montarSistema("decisao", config), c, "Decisao", 0.2);
  const notas = await chat<Notas>(montarSistema("notas", config),
    c + "\n\nFRASE QUE O LEAD REPETE: " + dec.frase_lead_repete, "Notas", 0.3);
  return [dec, notas];
}

export { canonico };
