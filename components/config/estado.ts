import { CABECALHO_EXTRAS, marcadorKb, montarSistemaResumo } from "@/lib/prompt-blocos";
import {
  CATEGORIA_DA_ETAPA, CATEGORIAS, LIMITES,
  type BlocoBase, type BlocoExtra, type Categoria, type DadosConfig, type Etapa, type InfoCategoria, type RespostaConfig,
} from "@/lib/prompt-tipos";

/**
 * Lógica pura da página de configuração do prompt: o rascunho (`DadosConfig`) é sempre derivado do salvo por funções
 * que devolvem um objeto novo. Nada aqui toca em React nem em rede.
 */

export const dadosVazios = (): DadosConfig => ({ alterados: {}, extras: [] });

export const copiarDados = (d: DadosConfig): DadosConfig => ({
  alterados: Object.fromEntries(Object.entries(d.alterados).map(([k, v]) => [k, { ...v }])),
  extras: d.extras.map((e) => ({ ...e })),
});

const aparar = (t: string) => t.trim();

/** Compara o conteúdo dos dois lados, ignorando a ordem das chaves e dos extras no vetor (a `ordem` é comparada à parte). */
export function igualDados(a: DadosConfig, b: DadosConfig): boolean {
  return contarMudancas(a, b) === 0;
}

// ───────────────────────── blocos originais ─────────────────────────

export const textoEfetivo = (bloco: BlocoBase, d: DadosConfig): string => d.alterados[bloco.id]?.texto ?? bloco.texto;
export const ativoEfetivo = (bloco: BlocoBase, d: DadosConfig): boolean => bloco.travado ? true : (d.alterados[bloco.id]?.ativo ?? true);
export const textoMudou = (bloco: BlocoBase, d: DadosConfig): boolean => {
  const a = d.alterados[bloco.id];
  return !!a && aparar(a.texto) !== aparar(bloco.texto);
};

/**
 * Grava a alteração de um bloco original. Se o texto voltou a ser igual ao original e o bloco está ligado, a entrada some
 * (o bloco volta a ser "Original"). Bloco travado é ignorado. `manterBase` conserva o `baseHash` já gravado: é o que a tela
 * usa ao digitar, para o aviso "o original mudou" não sumir na primeira letra; o padrão grava `bloco.hash`.
 */
export function alterarBloco(d: DadosConfig, bloco: BlocoBase, mudanca: { texto?: string; ativo?: boolean }, opcoes: { manterBase?: boolean } = {}): DadosConfig {
  if (bloco.travado) return d;
  const atual = d.alterados[bloco.id];
  const texto = mudanca.texto ?? atual?.texto ?? bloco.texto;
  const ativo = mudanca.ativo ?? atual?.ativo ?? true;
  const alterados = { ...d.alterados };
  if (ativo && aparar(texto) === aparar(bloco.texto)) delete alterados[bloco.id];
  else alterados[bloco.id] = { texto, ativo, baseHash: opcoes.manterBase && atual ? atual.baseHash : bloco.hash };
  return { ...d, alterados };
}

export function restaurarBloco(d: DadosConfig, id: string): DadosConfig {
  if (!(id in d.alterados)) return d;
  const alterados = { ...d.alterados };
  delete alterados[id];
  return { ...d, alterados };
}

/** O original do bloco mudou depois da edição do assessor (`baseHash` diferente do hash atual). */
export const originalMudou = (bloco: BlocoBase, d: DadosConfig): boolean => {
  const a = d.alterados[bloco.id];
  return !!a && a.baseHash !== bloco.hash;
};

/** "Manter a minha versão": aceita o original novo como base, sem mexer no texto. */
export function reconhecerOriginal(d: DadosConfig, bloco: BlocoBase): DadosConfig {
  const a = d.alterados[bloco.id];
  if (!a || a.baseHash === bloco.hash) return d;
  return { ...d, alterados: { ...d.alterados, [bloco.id]: { ...a, baseHash: bloco.hash } } };
}

// ───────────────────────── blocos próprios ─────────────────────────

const ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789";

/** "x_" + 16 caracteres [a-z0-9]. Usa rejeição para não enviesar o sorteio (256 não é múltiplo de 36). */
export function novoIdExtra(sorteio: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let s = "";
  while (s.length < 16) {
    for (const b of sorteio(32)) {
      if (b < 252 && s.length < 16) s += ALFABETO[b % 36];
    }
  }
  return `x_${s}`;
}

/** Título a partir do texto, quando o assessor não escreveu um: as primeiras palavras, até o limite. */
export function tituloAutomatico(texto: string): string {
  const linha = texto.trim().split(/\s+/).join(" ");
  if (!linha) return "Minha instrução";
  if (linha.length <= 40) return linha;
  const corte = linha.slice(0, 40);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > 20 ? corte.slice(0, espaco) : corte).replace(/[.,;:!?]+$/, "")}…`;
}

const renumerar = (extras: BlocoExtra[]): BlocoExtra[] => extras.map((e, i) => (e.ordem === i ? e : { ...e, ordem: i }));
const ordenados = (extras: BlocoExtra[]): BlocoExtra[] => [...extras].sort((a, b) => a.ordem - b.ordem);

export const extrasDa = (d: DadosConfig, categoria: Categoria): BlocoExtra[] => ordenados(d.extras).filter((e) => e.categoria === categoria);

export function adicionarExtra(d: DadosConfig, categoria: Categoria, titulo: string, texto: string, id = novoIdExtra()): { dados: DadosConfig; id: string } {
  const t = titulo.trim() || tituloAutomatico(texto);
  const extra: BlocoExtra = { id, categoria, titulo: t.slice(0, LIMITES.tituloBloco), texto, ativo: true, ordem: d.extras.length };
  return { dados: { ...d, extras: renumerar([...ordenados(d.extras), extra]) }, id };
}

export function atualizarExtra(d: DadosConfig, id: string, mudanca: Partial<Pick<BlocoExtra, "titulo" | "texto" | "ativo">>): DadosConfig {
  if (!d.extras.some((e) => e.id === id)) return d;
  return { ...d, extras: d.extras.map((e) => (e.id === id ? { ...e, ...mudanca } : e)) };
}

export function apagarExtra(d: DadosConfig, id: string): DadosConfig {
  if (!d.extras.some((e) => e.id === id)) return d;
  return { ...d, extras: renumerar(ordenados(d.extras).filter((e) => e.id !== id)) };
}

/** Copia o bloco logo abaixo do original, com o título "… (cópia)" cortado no limite. */
export function duplicarExtra(d: DadosConfig, id: string, novoId = novoIdExtra()): { dados: DadosConfig; id: string } | null {
  const lista = ordenados(d.extras);
  const i = lista.findIndex((e) => e.id === id);
  if (i < 0 || lista.length >= LIMITES.extras) return null;
  const o = lista[i];
  const sufixo = " (cópia)";
  const titulo = (o.titulo.length + sufixo.length > LIMITES.tituloBloco ? o.titulo.slice(0, LIMITES.tituloBloco - sufixo.length) : o.titulo) + sufixo;
  const copia: BlocoExtra = { ...o, id: novoId, titulo, ordem: o.ordem + 1 };
  lista.splice(i + 1, 0, copia);
  return { dados: { ...d, extras: renumerar(lista) }, id: novoId };
}

/** Desfaz "Apagar": devolve o bloco à posição em que estava (a `ordem` que ele tinha). */
export function reinserirExtra(d: DadosConfig, extra: BlocoExtra): DadosConfig {
  if (d.extras.some((e) => e.id === extra.id)) return d;
  const lista = ordenados(d.extras);
  lista.splice(Math.min(Math.max(extra.ordem, 0), lista.length), 0, extra);
  return { ...d, extras: renumerar(lista) };
}

/** Move um extra uma posição dentro da própria categoria (os de outras categorias não mudam de lugar relativo). */
export function moverExtra(d: DadosConfig, id: string, delta: -1 | 1): DadosConfig {
  const lista = ordenados(d.extras);
  const alvo = lista.find((e) => e.id === id);
  if (!alvo) return d;
  const daCategoria = lista.filter((e) => e.categoria === alvo.categoria);
  const k = daCategoria.findIndex((e) => e.id === id);
  const vizinho = daCategoria[k + delta];
  if (!vizinho) return d;
  const a = lista.indexOf(alvo), b = lista.indexOf(vizinho);
  [lista[a], lista[b]] = [lista[b], lista[a]];
  return { ...d, extras: renumerar(lista) };
}

/** Arrastar: põe `id` antes (ou depois) de `alvoId`, ambos da mesma categoria. */
export function reposicionarExtra(d: DadosConfig, id: string, alvoId: string, depois: boolean): DadosConfig {
  if (id === alvoId) return d;
  const lista = ordenados(d.extras);
  const mover = lista.find((e) => e.id === id), alvo = lista.find((e) => e.id === alvoId);
  if (!mover || !alvo || mover.categoria !== alvo.categoria) return d;
  const sem = lista.filter((e) => e.id !== id);
  const pos = sem.indexOf(alvo) + (depois ? 1 : 0);
  sem.splice(pos, 0, mover);
  return { ...d, extras: renumerar(sem) };
}

export const podeMover = (d: DadosConfig, id: string, delta: -1 | 1): boolean => {
  const alvo = d.extras.find((e) => e.id === id);
  if (!alvo) return false;
  const lista = extrasDa(d, alvo.categoria);
  const k = lista.findIndex((e) => e.id === id);
  return k + delta >= 0 && k + delta < lista.length;
};

// ───────────────────────── restaurar ─────────────────────────

/** Restaura todos os blocos de uma categoria: tira os alterados dela e apaga os extras dela. */
export function restaurarCategoria(d: DadosConfig, blocos: BlocoBase[], categoria: Categoria): DadosConfig {
  const ids = new Set(blocos.filter((b) => b.categoria === categoria).map((b) => b.id));
  const alterados = Object.fromEntries(Object.entries(d.alterados).filter(([id]) => !ids.has(id)));
  return { alterados, extras: renumerar(ordenados(d.extras).filter((e) => e.categoria !== categoria)) };
}

/** Desfaz "Restaurar etapa": devolve a `categoria` ao que ela era em `antes`, sem tocar nas outras categorias. */
export function substituirCategoria(d: DadosConfig, blocos: BlocoBase[], categoria: Categoria, antes: DadosConfig): DadosConfig {
  const ids = new Set(blocos.filter((b) => b.categoria === categoria).map((b) => b.id));
  const alterados = {
    ...Object.fromEntries(Object.entries(d.alterados).filter(([id]) => !ids.has(id))),
    ...Object.fromEntries(Object.entries(antes.alterados).filter(([id]) => ids.has(id))),
  };
  return { alterados, extras: renumerar([...ordenados(d.extras).filter((e) => e.categoria !== categoria), ...extrasDa(antes, categoria)]) };
}

export interface Perdas { editados: number; desligados: number; proprios: number }

/** O que "Restaurar" apagaria. Sem `categoria`, a configuração inteira. Blocos editados e desligados ao mesmo tempo contam como editados. */
export function perdas(d: DadosConfig, blocos: BlocoBase[], categoria?: Categoria): Perdas {
  const cat = new Map(blocos.map((b) => [b.id, b.categoria]));
  let editados = 0, desligados = 0;
  for (const [id, a] of Object.entries(d.alterados)) {
    const c = cat.get(id);
    if (categoria && c !== categoria) continue;
    const bloco = blocos.find((b) => b.id === id);
    if (bloco && aparar(a.texto) !== aparar(bloco.texto)) editados++;
    else desligados++;
  }
  const proprios = d.extras.filter((e) => !categoria || e.categoria === categoria).length;
  return { editados, desligados, proprios };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "2 blocos editados, 1 bloco desligado e 3 instruções suas". Vazio se não há nada. */
export function descreverPerdas(p: Perdas): string {
  const partes: string[] = [];
  if (p.editados) partes.push(plural(p.editados, "bloco editado", "blocos editados"));
  if (p.desligados) partes.push(plural(p.desligados, "bloco desligado", "blocos desligados"));
  if (p.proprios) partes.push(plural(p.proprios, "instrução sua", "instruções suas"));
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

export const temPerdas = (p: Perdas) => p.editados + p.desligados + p.proprios > 0;

// ───────────────────────── contagem de mudanças ─────────────────────────

const camposExtra = (e: BlocoExtra) => JSON.stringify([e.categoria, e.titulo, e.texto, e.ativo]);

/**
 * Quantas alterações o rascunho tem em relação ao salvo. Cada bloco original que difere conta 1; cada extra novo,
 * apagado ou modificado conta 1; reordenar os extras de uma categoria conta 1 por categoria.
 */
export function contarMudancas(salvo: DadosConfig, rascunho: DadosConfig): number {
  return Object.values(mudancasPorCategoriaMapa(salvo, rascunho, null)).reduce((s, n) => s + n, 0);
}

/** Alterações por categoria (para o indicador da navegação). Ids de originais desconhecidos caem em `geral`. */
export function mudancasPorCategoria(salvo: DadosConfig, rascunho: DadosConfig, blocos: BlocoBase[]): Record<Categoria, number> {
  return mudancasPorCategoriaMapa(salvo, rascunho, blocos);
}

function mudancasPorCategoriaMapa(salvo: DadosConfig, rascunho: DadosConfig, blocos: BlocoBase[] | null): Record<Categoria, number> {
  const r = Object.fromEntries(CATEGORIAS.map((c) => [c, 0])) as Record<Categoria, number>;
  const catDe = new Map((blocos ?? []).map((b) => [b.id, b.categoria]));
  for (const id of new Set([...Object.keys(salvo.alterados), ...Object.keys(rascunho.alterados)])) {
    const a = salvo.alterados[id], b = rascunho.alterados[id];
    if (a && b && a.texto === b.texto && a.ativo === b.ativo && a.baseHash === b.baseHash) continue;
    r[catDe.get(id) ?? "geral"]++;
  }
  const antes = new Map(salvo.extras.map((e) => [e.id, e])), depois = new Map(rascunho.extras.map((e) => [e.id, e]));
  for (const [id, e] of depois) {
    const o = antes.get(id);
    if (!o || camposExtra(o) !== camposExtra(e)) r[e.categoria]++;
  }
  for (const [id, e] of antes) if (!depois.has(id)) r[e.categoria]++;
  for (const c of CATEGORIAS) {
    const comuns = new Set([...antes.keys()].filter((id) => depois.has(id)));
    const seq = (d: DadosConfig) => extrasDa(d, c).filter((e) => comuns.has(e.id)).map((e) => e.id).join(",");
    if (seq(salvo) !== seq(rascunho)) r[c]++;
  }
  return r;
}

// ───────────────────────── validação local ─────────────────────────

export interface Erros {
  /** Por id de bloco (original ou extra). */
  blocos: Record<string, string>;
  /** Por categoria: soma dos extras acima do limite da etapa. */
  categorias: Partial<Record<Categoria, string>>;
  /** Geral (ex.: mais de 20 instruções). */
  geral: string | null;
}

export const ERRO_VAZIO_ORIGINAL = "O texto não pode ficar vazio. Para tirar este bloco, desligue-o.";
export const ERRO_VAZIO_EXTRA = "Escreva a instrução ou apague este bloco.";

export function erroDoTexto(texto: string, original: boolean): string | null {
  if (!texto.trim()) return original ? ERRO_VAZIO_ORIGINAL : ERRO_VAZIO_EXTRA;
  if (texto.length > LIMITES.textoBloco) return `Passou do limite de ${LIMITES.textoBloco.toLocaleString("pt-BR")} caracteres (${texto.length.toLocaleString("pt-BR")}).`;
  return null;
}

export function erroDoTitulo(titulo: string): string | null {
  return titulo.length > LIMITES.tituloBloco ? `O título passou de ${LIMITES.tituloBloco} caracteres.` : null;
}

/** Caracteres dos extras ativos que entram numa etapa da categoria: os de `geral` mais os dela. */
export function usoExtras(d: DadosConfig, categoria: Categoria): number {
  return d.extras.filter((e) => e.ativo && (e.categoria === "geral" || e.categoria === categoria)).reduce((s, e) => s + e.texto.trim().length, 0);
}

export function validarDados(d: DadosConfig, blocos: BlocoBase[]): Erros {
  const erros: Erros = { blocos: {}, categorias: {}, geral: null };
  const porId = new Map(blocos.map((b) => [b.id, b]));
  for (const [id, a] of Object.entries(d.alterados)) {
    const b = porId.get(id);
    if (!b || b.travado) continue;
    const e = erroDoTexto(a.texto, true);
    if (e) erros.blocos[id] = e;
  }
  for (const x of d.extras) {
    const e = erroDoTexto(x.texto, false) ?? erroDoTitulo(x.titulo);
    if (e) erros.blocos[x.id] = e;
  }
  if (d.extras.length > LIMITES.extras) erros.geral = `O limite é de ${LIMITES.extras} instruções próprias.`;
  for (const c of CATEGORIAS) {
    const uso = usoExtras(d, c);
    if (uso > LIMITES.extrasPorEtapa) {
      erros.categorias[c] = c === "geral"
        ? `As instruções gerais passam do limite de ${LIMITES.extrasPorEtapa.toLocaleString("pt-BR")} caracteres por etapa.`
        : `As instruções desta etapa (com as gerais) passam do limite de ${LIMITES.extrasPorEtapa.toLocaleString("pt-BR")} caracteres.`;
    }
  }
  return erros;
}

export const temErros = (e: Erros): boolean => Object.keys(e.blocos).length > 0 || Object.keys(e.categorias).length > 0 || e.geral !== null;

/** Categorias com algum erro (blocos próprios, originais ou limite da etapa), para marcar na navegação. */
export function categoriasComErro(e: Erros, d: DadosConfig, blocos: BlocoBase[]): Set<Categoria> {
  const s = new Set<Categoria>(Object.keys(e.categorias) as Categoria[]);
  for (const id of Object.keys(e.blocos)) {
    const c = blocos.find((b) => b.id === id)?.categoria ?? d.extras.find((x) => x.id === id)?.categoria;
    if (c) s.add(c);
  }
  return s;
}

// ───────────────────────── modelo de exibição dos cards ─────────────────────────

export type Selo = "original" | "editado" | "desligado" | "proprio" | "travado";

export interface ItemBloco {
  id: string;
  tipo: "original" | "extra";
  titulo: string;
  ajuda: string;
  texto: string;
  ativo: boolean;
  travado: boolean;
  selos: Selo[];
  /** Só nos originais: texto original (para "Ver original") e se mudou o texto. */
  textoOriginal?: string;
  editado: boolean;
  originalMudou: boolean;
}

export function selosDe(bloco: BlocoBase, d: DadosConfig): Selo[] {
  if (bloco.travado) return ["travado"];
  const ativo = ativoEfetivo(bloco, d), mudou = textoMudou(bloco, d);
  if (ativo) return [mudou ? "editado" : "original"];
  return mudou ? ["editado", "desligado"] : ["desligado"];
}

/** Itens de uma categoria na ordem da tela: os originais do catálogo, depois os blocos próprios. */
export function itensDaCategoria(blocos: BlocoBase[], d: DadosConfig, categoria: Categoria): ItemBloco[] {
  const originais: ItemBloco[] = blocos.filter((b) => b.categoria === categoria).map((b) => ({
    id: b.id, tipo: "original", titulo: b.titulo, ajuda: b.ajuda, texto: textoEfetivo(b, d), ativo: ativoEfetivo(b, d),
    travado: !!b.travado, selos: selosDe(b, d), textoOriginal: b.texto, editado: textoMudou(b, d), originalMudou: originalMudou(b, d),
  }));
  const proprios: ItemBloco[] = extrasDa(d, categoria).map((e) => ({
    id: e.id, tipo: "extra", titulo: e.titulo, ajuda: "", texto: e.texto, ativo: e.ativo, travado: false,
    selos: e.ativo ? ["proprio"] : ["proprio", "desligado"], editado: false, originalMudou: false,
  }));
  return [...originais, ...proprios];
}

/** O bloco original está diferente do catálogo (texto ou desligado): habilita "Restaurar original". */
export const estaAlterado = (item: ItemBloco): boolean => item.tipo === "original" && !item.travado && (item.editado || !item.ativo);

// ───────────────────────── diferença entre textos ─────────────────────────

export interface TrechoDiff { texto: string; tipo: "igual" | "removido" | "adicionado" }

/** Diferença por palavras (maior subsequência comum). Textos enormes caem num bloco removido + um adicionado. */
export function diffPalavras(original: string, novo: string): TrechoDiff[] {
  const a = original.split(/(\s+)/).filter(Boolean), b = novo.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 600_000) return [{ texto: original, tipo: "removido" }, { texto: novo, tipo: "adicionado" }];
  const n = a.length, m = b.length;
  const t: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const saida: TrechoDiff[] = [];
  const empurrar = (texto: string, tipo: TrechoDiff["tipo"]) => {
    const ult = saida[saida.length - 1];
    if (ult && ult.tipo === tipo) ult.texto += texto; else saida.push({ texto, tipo });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { empurrar(a[i], "igual"); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) empurrar(a[i++], "removido");
    else empurrar(b[j++], "adicionado");
  }
  while (i < n) empurrar(a[i++], "removido");
  while (j < m) empurrar(b[j++], "adicionado");
  return saida;
}

// ───────────────────────── prévia do prompt final ─────────────────────────

export const ROTULO_ETAPA: Record<Etapa, string> = {
  ativos: "Leitura da carteira (extrato)",
  ativos_transcricao: "Carteira pela transcrição",
  lead: "Perfil do lead",
  alocacao: "Proposta De → Para",
  diagnostico: "Diagnóstico",
  decisao: "Decisão e resumo",
  notas: "Notas do apresentador",
};

export type TipoSegmento = "base" | "assessor" | "referencia" | "extras";
export interface Segmento { tipo: TipoSegmento; texto: string; /** Só em `referencia`: os arquivos da base de conhecimento. */ itens?: string[] }

export interface Previa { segmentos: Segmento[]; /** A categoria tem mais de uma etapa e a prévia mostra todos os blocos dela. */ avisoEtapas: string | null }

/** Etapas que compartilham a categoria (hoje só "carteira" tem duas). */
export const etapasDaCategoria = (c: Categoria): Etapa[] => (Object.keys(CATEGORIA_DA_ETAPA) as Etapa[]).filter((e) => CATEGORIA_DA_ETAPA[e] === c);

/**
 * Prévia do system prompt de uma etapa: o mesmo texto de `montarSistema` (servidor), com a base de conhecimento trocada por
 * um marcador. Vem de `montarSistemaResumo` (lib/prompt-blocos.ts); aqui só se separa o que a gaveta destaca: o trecho do
 * assessor, o marcador da base (recolhido, com a lista de arquivos) e o cabeçalho das instruções.
 */
export function montarPrevia(etapa: Etapa, resp: Pick<RespostaConfig, "categorias" | "tamanhoKb">, d: DadosConfig): Previa {
  const categoria = CATEGORIA_DA_ETAPA[etapa];
  const info: InfoCategoria | undefined = resp.categorias.find((c) => c.id === categoria);
  const marcador = marcadorKb(etapa, resp.tamanhoKb?.[etapa]);
  const segmentos: Segmento[] = [];
  const soltar = (tipo: "base" | "extras", texto: string) => { if (texto) segmentos.push({ tipo, texto }); };
  for (const t of montarSistemaResumo(etapa, d, resp.tamanhoKb?.[etapa])) {
    if (t.origem === "assessor") { segmentos.push({ tipo: "assessor", texto: t.texto }); continue; }
    let resto = t.texto;
    const iMarc = marcador ? resto.indexOf(marcador) : -1;
    if (iMarc >= 0) {
      soltar("base", resto.slice(0, iMarc));
      segmentos.push({ tipo: "referencia", texto: marcador, itens: info?.referencia ?? [] });
      resto = resto.slice(iMarc + marcador.length);
    }
    const iCab = resto.indexOf(CABECALHO_EXTRAS);
    if (iCab >= 0) {
      soltar("base", resto.slice(0, iCab));
      soltar("extras", CABECALHO_EXTRAS);
      resto = resto.slice(iCab + CABECALHO_EXTRAS.length);
    }
    soltar("base", resto);
  }
  const irmas = etapasDaCategoria(categoria);
  const avisoEtapas = irmas.length > 1
    ? `A categoria "${info?.titulo ?? categoria}" tem ${irmas.length} etapas (${irmas.map((e) => ROTULO_ETAPA[e]).join(" e ")}), cada uma com os seus blocos. Aqui aparece a etapa escolhida.`
    : null;
  return { segmentos, avisoEtapas };
}
