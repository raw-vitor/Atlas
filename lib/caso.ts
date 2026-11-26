/** O caso: estado de uma conversa no servidor. Em memória, com TTL, como os jobs. Nada do lead vai para o disco. */
import crypto from "node:crypto";
import { config } from "./config";
import { valoresCitados } from "./citados";
import { eSubstituivelPorExtrato } from "./triagem-llm";
import type { Alocacao, Analise, Ativo, Decisao, Diagnostico, Lead, Notas } from "./types";

/** "contexto": deck anterior, anotações e afins. Não é posição nem fala do lead; só ajuda a ler o lead. */
export type PapelFonte = "carteira" | "transcricao" | "contexto";

export interface Fonte {
  /** "usuario" | "automatico" | "declarado"; "transcricao" marca a carteira derivada dos valores citados na R1. */
  nome: string; papel: PapelFonte; origemPapel: string; texto: string; hash: string;
  /** Resultado da leitura, guardado para não pagar a extração de novo. */
  ativos?: Ativo[]; dataPosicao?: string;
  /** O que o LLM entendeu do arquivo (extrato, transcricao_r1, deck_anterior, anotacoes, outro). Ausente se a triagem não decidiu. */
  tipo?: string;
}
export interface AjustesLead { primeiro_nome?: string; perfil?: string; objetivos?: string[] }
export interface Rascunho {
  aloc: Alocacao; diag: Diagnostico; dec: Decisao; notas: Notas;
  avisos: string[]; pendencias: string[]; dataR2: string;
}
export interface Edicao { quando: number; campo: string; antes: unknown; depois: unknown; origem: "assessor" }
export interface DeckVersao { jobId: string; versao: number; criadoEm: number }

export interface Caso {
  id: string; criado: number; atualizado: number; ocupado: boolean;
  fontes: Fonte[];
  assessor?: string; dataR2?: string; // dataR2 em AAAA-MM-DD
  lead?: Lead; leadHash?: string;
  /** Ajustes do assessor no lead (nome, perfil, objetivos). Valem de novo se a transcrição for relida. */
  ajustesLead?: AjustesLead;
  /** Assinatura das carteiras já lidas; muda quando uma fonte de carteira entra ou sai. */
  carteiraSig?: string;
  ativos: Ativo[]; dataPosicao: string; pendenciasCarteira: string[]; avisosLeitura: string[];
  analise?: Analise;
  divergencias: never[]; // fase 3
  rascunho?: Rascunho;
  edicoes: Edicao[];
  decks: DeckVersao[];
}

const g = globalThis as unknown as { __atlasCasos?: Map<string, Caso> };
const casos = (g.__atlasCasos ??= new Map<string, Caso>());

export function limparCasos() {
  const agora = Date.now();
  for (const [id, c] of casos) if (!c.ocupado && agora - c.atualizado > config.jobTtlMin * 60_000) casos.delete(id);
}

/** Caso que não entra no armazenamento (usado por `rodar`, que não tem conversa). */
export function casoAvulso(): Caso {
  const id = crypto.randomBytes(16).toString("hex"); // 128 bits
  const agora = Date.now();
  return { id, criado: agora, atualizado: agora, ocupado: false, fontes: [], ativos: [], dataPosicao: "",
    pendenciasCarteira: [], avisosLeitura: [], divergencias: [], edicoes: [], decks: [] };
}

export function novoCaso(): Caso {
  limparCasos();
  const c = casoAvulso();
  casos.set(c.id, c);
  return c;
}

export const obterCaso = (id: string) => (/^[0-9a-f]{32}$/.test(id) ? casos.get(id) : undefined);
export const tocar = (c: Caso) => { c.atualizado = Date.now(); };
export const hashTexto = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export interface Prontidao {
  itens: { chave: string; rotulo: string; acao: string; obrigatorio: boolean; ok: boolean }[];
  pronto: boolean; faltas: string[]; faltasAcoes: string[];
}

/** Aplica os ajustes do assessor ao lead (objetivos entram sem repetir). */
export function aplicarAjustes(lead: Lead, a: AjustesLead = {}): Lead {
  const objetivos = [...lead.objetivos];
  for (const o of a.objetivos ?? []) if (!objetivos.some((x) => x.toLowerCase() === o.toLowerCase())) objetivos.push(o);
  return { ...lead, primeiro_nome: a.primeiro_nome ?? lead.primeiro_nome, perfil: a.perfil ?? lead.perfil, objetivos };
}

export const NOME_FONTE_DERIVADA = "valores citados na R1";
const ROTULOS_DE_FALA = ["lead", "cliente", "assessor", "assessora"];

/** "Lead", "Cliente" e "Assessor" são rótulos de quem fala, não o nome do lead. */
export function limparNome(nome: string): string {
  const n = (nome ?? "").trim();
  const k = n.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return ROTULOS_DE_FALA.includes(k) ? "" : n;
}

export const eDerivada = (f: Fonte) => f.papel === "carteira" && f.origemPapel === "transcricao";
export const temCarteiraReal = (c: Caso) => c.fontes.some((f) => f.papel === "carteira" && !eDerivada(f));
export const textoTranscricoes = (c: Caso) => c.fontes.filter((f) => f.papel === "transcricao").map((f) => f.texto).join("\n");

/** Chegou um extrato: a posição de deck anterior ou anotações que estava como carteira passa a ser só contexto. Devolve os nomes. */
export function rebaixarCarteirasSubstituiveis(c: Caso): string[] {
  const nomes: string[] = [];
  for (const f of c.fontes) {
    if (f.papel === "carteira" && eSubstituivelPorExtrato(f.tipo)) { f.papel = "contexto"; f.ativos = undefined; f.dataPosicao = undefined; nomes.push(f.nome); }
  }
  return nomes;
}

/** Há extrato (ou carteira sem tipo, enviada pelo assessor) entre as carteiras do caso. */
export const temExtrato = (c: Caso) => c.fontes.some((f) => f.papel === "carteira" && !eDerivada(f) && !eSubstituivelPorExtrato(f.tipo));

/** Tira a carteira derivada da transcrição. Devolve true se havia uma. */
export function removerDerivada(c: Caso): boolean {
  const antes = c.fontes.length;
  c.fontes = c.fontes.filter((f) => !eDerivada(f));
  return c.fontes.length !== antes;
}

/** O que falta para gerar o deck. Calculado em código; o painel e o botão usam isto. */
export function prontidao(c: Caso): Prontidao {
  const itens = [
    { chave: "ativos", rotulo: "Carteira com ao menos 1 ativo com valor", acao: "Envie a carteira do lead: anexe o extrato (planilha, PDF ou print) ou cole a posição aqui.", obrigatorio: true, ok: (c.analise?.total ?? 0) > 0 },
    { chave: "nome", rotulo: "Primeiro nome do lead", acao: "Diga o primeiro nome do lead (ex.: \"o lead é o Carlos\").", obrigatorio: true, ok: !!limparNome(c.lead?.primeiro_nome ?? "") },
    { chave: "perfil", rotulo: "Perfil (Conservador, Moderado ou Arrojado)", acao: "Diga o perfil do lead: Conservador, Moderado ou Arrojado.", obrigatorio: true, ok: !!c.lead?.perfil?.trim() },
    { chave: "objetivo", rotulo: "Ao menos 1 objetivo", acao: "Diga ao menos um objetivo do lead (ex.: \"aposentar aos 60\").", obrigatorio: true, ok: (c.lead?.objetivos.filter((o) => !/a confirmar/i.test(o)).length ?? 0) > 0 },
    { chave: "frases", rotulo: "Frases literais do lead", acao: "Envie uma transcrição com falas do lead.", obrigatorio: false, ok: (c.lead?.frases_literais.length ?? 0) > 0 },
    { chave: "transcricao", rotulo: "Transcrição da R1", acao: "Anexe a transcrição da R1 ou cole o texto aqui.", obrigatorio: false, ok: c.fontes.some((f) => f.papel === "transcricao") },
    { chave: "assessor", rotulo: "Assessor e data da R2", acao: "Diga o nome do assessor e a data da R2.", obrigatorio: false, ok: !!c.assessor && !!c.dataR2 },
  ];
  const faltando = itens.filter((i) => i.obrigatorio && !i.ok);
  return { itens, pronto: faltando.length === 0, faltas: faltando.map((i) => i.rotulo), faltasAcoes: faltando.map((i) => i.acao) };
}

/** Trechos da transcrição com valor em R$, se a carteira puder vir dela. Vazio quando a opção não vale. */
export function valoresParaCarteira(c: Caso): string[] {
  const semAtivos = !prontidao(c).itens.find((i) => i.chave === "ativos")!.ok;
  if (!semAtivos || temCarteiraReal(c) || !c.fontes.some((f) => f.papel === "transcricao")) return [];
  return valoresCitados(textoTranscricoes(c));
}

/** Estado enviado ao navegador: sem o texto das fontes. */
export function publicoCaso(c: Caso) {
  return {
    id: c.id,
    fontes: c.fontes.map((f) => ({ nome: f.nome, papel: f.papel, origemPapel: f.origemPapel, tipo: f.tipo ?? null })),
    assessor: c.assessor ?? null, dataR2: c.dataR2 ?? null,
    lead: c.lead ? { nome: limparNome(c.lead.primeiro_nome), perfil: c.lead.perfil, objetivos: c.lead.objetivos, aporteMensal: c.lead.aporte_mensal, lacunas: c.lead.lacunas } : null,
    carteira: c.analise ? { total: c.analise.total, nAtivos: c.analise.n_ativos, pctClasse: c.analise.pct_classe } : null,
    avisos: c.avisosLeitura, pendencias: c.pendenciasCarteira,
    opcoes: valoresParaCarteira(c).length ? [{ id: "usar_transcricao" as const, rotulo: "Usar valores da transcrição" }] : [],
    rascunhoPronto: !!c.rascunho, decks: c.decks, prontidao: prontidao(c), ocupado: c.ocupado,
  };
}
export type CasoPublico = ReturnType<typeof publicoCaso>;
