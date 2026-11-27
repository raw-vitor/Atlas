/**
 * O caso: estado de uma conversa. Mora no Durable Object `Conversa` (fonte de verdade, com versão e trava por tarefa); o texto das
 * fontes mora em R2 (`chaveFonte`), porque uma transcrição chega a 200 mil caracteres. Aqui ficam o tipo, a lógica pura sobre o caso
 * e o carregar/salvar (`obterCaso`, `hidratarFontes`, `salvarCaso`). Nada do lead vai para o log.
 */
import crypto from "node:crypto";
import { chaveFonte } from "./r2";
import { valoresCitados } from "./citados";
import { checarDados } from "./validate";
import { eSubstituivelPorExtrato } from "./triagem-llm";
import type { Alocacao, Analise, Ativo, Aviso, Decisao, Diagnostico, Lead, Notas } from "./types";

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
  avisos: Aviso[]; pendencias: string[]; dataR2: string;
}
export interface MensagemHistorico { papel: "assessor" | "atlas"; texto: string; quando: number }
export const MAX_HISTORICO = 20;
export interface Edicao { quando: number; campo: string; antes: unknown; depois: unknown; origem: "assessor" }
export interface DeckVersao { jobId: string; versao: number; criadoEm: number }

export interface Caso {
  id: string; criado: number; atualizado: number;
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
  /** Últimas mensagens da conversa (até MAX_HISTORICO). */
  historico: MensagemHistorico[];
}

/** Guarda uma mensagem no histórico do caso, mantendo só as últimas MAX_HISTORICO. Texto vazio não entra. */
export function registrar(c: Caso, papel: MensagemHistorico["papel"], texto: string) {
  if (!texto.trim()) return;
  c.historico.push({ papel, texto, quando: Date.now() });
  if (c.historico.length > MAX_HISTORICO) c.historico.splice(0, c.historico.length - MAX_HISTORICO);
}

/** Caso que não entra no armazenamento (usado por testes e por quem só precisa de um caso vazio). */
export function casoAvulso(): Caso {
  return novoCaso(crypto.randomBytes(16).toString("hex")); // 128 bits
}

/** Caso vazio com o id da conversa. Não grava nada: o DO só guarda o caso depois da primeira tarefa. */
export function novoCaso(id: string): Caso {
  const agora = Date.now();
  return { id, criado: agora, atualizado: agora, fontes: [], ativos: [], dataPosicao: "",
    pendenciasCarteira: [], avisosLeitura: [], divergencias: [], edicoes: [], decks: [], historico: [] };
}

/** Cópia do estado para desfazer uma mensagem cancelada. */
export const copiarCaso = (c: Caso): Caso => structuredClone(c);
/** Devolve o caso ao estado da cópia, mantendo o mesmo objeto. */
export function restaurarCaso(c: Caso, copia: Caso) {
  for (const k of Object.keys(c)) if (!(k in copia)) delete (c as unknown as Record<string, unknown>)[k];
  Object.assign(c, copia);
}
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
  const dados = avisosDosDados(c);
  return {
    id: c.id,
    fontes: c.fontes.map((f) => ({ nome: f.nome, papel: f.papel, origemPapel: f.origemPapel, tipo: f.tipo ?? null })),
    assessor: c.assessor ?? null, dataR2: c.dataR2 ?? null,
    lead: c.lead ? { nome: limparNome(c.lead.primeiro_nome), perfil: c.lead.perfil, objetivos: c.lead.objetivos, aporteMensal: c.lead.aporte_mensal, lacunas: c.lead.lacunas } : null,
    carteira: c.analise ? { total: c.analise.total, nAtivos: c.analise.n_ativos, pctClasse: c.analise.pct_classe } : null,
    avisos: c.avisosLeitura, pendencias: c.pendenciasCarteira,
    avisosMetodo: dados.avisos.map((a) => a.texto), pendenciasMetodo: dados.pendencias,
    opcoes: valoresParaCarteira(c).length ? [{ id: "usar_transcricao" as const, rotulo: "Usar valores da transcrição" }] : [],
    rascunhoPronto: !!c.rascunho, decks: c.decks, prontidao: prontidao(c),
    // Quem está ocupado é a conversa (tarefa ativa no DO), não o caso: quem monta a resposta sobrescreve com `tarefa`.
    ocupado: false,
  };
}
export type CasoPublico = ReturnType<typeof publicoCaso>;

export const MAX_TRANSCRICAO_CHARS = 200_000;

/** Uma transcrição vai como está. Várias são juntadas em ordem de nome; acima do limite, só a maior. */
export function juntarTranscricoes(textos: { nome: string; texto: string }[]): { texto: string; aviso?: string } {
  if (textos.length === 1) return { texto: textos[0].texto };
  const junto = textos.map((t) => `--- transcrição: ${t.nome} ---\n${t.texto}`).join("\n\n");
  if (junto.length <= MAX_TRANSCRICAO_CHARS) return { texto: junto };
  const maior = textos.reduce((a, b) => (b.texto.length > a.texto.length ? b : a));
  return { texto: maior.texto, aviso: `As transcrições passam de ${MAX_TRANSCRICAO_CHARS} caracteres juntas. Usei só a maior (${maior.nome}).` };
}

/** Transcrições do caso em ordem de nome, juntadas como o rascunho faz. */
export function transcricaoJunta(c: Caso): { texto: string; aviso?: string } {
  const trs = c.fontes.filter((f) => f.papel === "transcricao").sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR", { numeric: true }));
  return trs.length ? juntarTranscricoes(trs) : { texto: "" };
}

/** Avisos e pendências do método que dependem só dos dados lidos. Puro sobre o estado do caso. */
export function avisosDosDados(c: Caso): { avisos: Aviso[]; pendencias: string[] } {
  if (!c.lead || !c.analise) return { avisos: [], pendencias: [] };
  const [avisos, pendencias] = checarDados(c.lead, c.ativos, c.analise, transcricaoJunta(c).texto);
  return { avisos, pendencias };
}

// ---------------------------------------------------------------- persistência (Durable Object + R2)

/** O caso como o DO o guarda: o mesmo JSON, sem o texto das fontes (que fica em R2). */
export type CasoSalvo = Omit<Caso, "fontes"> & { fontes: Omit<Fonte, "texto">[] };

export type ResultadoSalvarCaso =
  | { ok: true; versao: number }
  | { ok: false; motivo: "versao" | "tarefa" | "purgada"; versao: number };

/** Fontes que vieram do DO (ou já foram gravadas nele): o texto delas está em R2, então não precisa subir de novo. */
const noR2 = new WeakSet<Fonte>();

const stubDe = (e: CloudflareEnv, conversaId: string) => e.CONVERSA.get(e.CONVERSA.idFromName(conversaId));

/**
 * O caso vigente da conversa e a versão (para `salvarCaso`). Numa conversa sem caso, devolve um caso vazio com o id dela.
 * As fontes chegam com `texto` vazio: `hidratarFontes` busca o que a lógica for usar.
 */
export async function obterCaso(e: CloudflareEnv, conversaId: string): Promise<{ caso: Caso; versao: number }> {
  const { caso: salvo, versao } = await stubDe(e, conversaId).obterCaso();
  if (!salvo) return { caso: novoCaso(conversaId), versao };
  const caso = salvo as Caso;
  for (const f of caso.fontes) { f.texto = ""; noR2.add(f); }
  return { caso, versao };
}

/**
 * Lê do R2 o texto das fontes que vieram do DO: todas, as dos `papeis` pedidos ou as que o filtro aceitar. Falta de objeto lança:
 * seguir com texto vazio refaria a leitura do lead em cima de nada. Fontes criadas nesta execução já têm o texto e são ignoradas.
 */
export async function hidratarFontes(
  e: CloudflareEnv, usuarioId: string, conversaId: string, caso: Caso, selecao?: readonly PapelFonte[] | ((f: Fonte) => boolean),
): Promise<void> {
  const quer = (f: Fonte) => !selecao || (typeof selecao === "function" ? selecao(f) : selecao.includes(f.papel));
  await Promise.all(caso.fontes.map(async (f) => {
    if (!noR2.has(f) || f.texto || !quer(f)) return;
    const o = await e.ARQUIVOS.get(chaveFonte(usuarioId, conversaId, f.hash));
    if (!o) throw new Error(`Não encontrei o texto guardado de "${f.nome}". Envie o arquivo de novo.`);
    f.texto = await o.text();
  }));
}

/**
 * Grava o caso no DO. Antes, sobe para o R2 o texto das fontes novas (se o DO recusar, ficam objetos soltos no prefixo da conversa,
 * que a purga apaga; o contrário, um caso apontando para texto que não existe, não acontece). `opcoes` são as do DO: `versao` (controle
 * otimista) e `tarefaId` (só grava enquanto a tarefa estiver ativa).
 */
export async function salvarCaso(
  e: CloudflareEnv, usuarioId: string, conversaId: string, caso: Caso, opcoes: { versao?: number; tarefaId?: string } = {},
): Promise<ResultadoSalvarCaso> {
  const novas = caso.fontes.filter((f) => !noR2.has(f) && f.texto);
  await Promise.all(novas.map((f) =>
    e.ARQUIVOS.put(chaveFonte(usuarioId, conversaId, f.hash), f.texto, { httpMetadata: { contentType: "text/plain; charset=utf-8" } })));
  const salvo: CasoSalvo = { ...caso, fontes: caso.fontes.map(({ texto: _texto, ...resto }) => (void _texto, resto)) };
  const r = await stubDe(e, conversaId).salvarCaso(salvo, opcoes);
  if (r.ok) for (const f of novas) noR2.add(f);
  return r;
}
