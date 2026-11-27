/**
 * Catálogo dos blocos do prompt.
 * Módulo puro e importável no navegador: não importa `kb()`/knowledge.gerado (a base inteira). A montagem com a base
 * de conhecimento fica em `lib/prompt-montagem.ts` (servidor).
 *
 * REGRA DOS SEPARADORES. Cada bloco original é um trecho contíguo de PAPEL ou de uma TAREFA_*. O texto bruto do
 * trecho tem três partes: `antes` (espaços e quebras de linha no início), o MIOLO e `depois` (vírgulas, espaços e
 * quebras de linha no fim). Só o miolo é editável: é ele que aparece em `BlocoBase.texto`, que o assessor edita e que
 * `hashBase` resume. `antes`/`depois` são fixos e nunca saem do código.
 * Ao montar um grupo (PAPEL ou a TAREFA de uma etapa) com os blocos que continuam ligados:
 *   entrada (o `antes` do primeiro bloco original do grupo) + miolo1 + (depois1 + antes2) + miolo2 + ... + saída
 * em que saída é o `depois` do último bloco original do grupo. Assim, desligar o primeiro ou o último bloco não
 * perde o "\n\nTarefa" inicial nem deixa vírgula ou espaço sobrando no fim. Se desligar um bloco do meio deixar
 * dois miolos sem separador, entra um espaço. Quando blocos desligados deixam uma frase sem fechar (o miolo anterior
 * não termina em ponto e o próximo começa com maiúscula, ou a frase termina no fim do grupo), entra um ponto. Sem alterações, a concatenação reproduz a constante original.
 */
import {
  CATEGORIAS, CATEGORIA_DA_ETAPA, ETAPAS, LIMITES, hashBase,
  type BlocoBase, type BlocoAlterado, type BlocoExtra, type Categoria, type DadosConfig, type Etapa, type InfoCategoria,
} from "./prompt-tipos";

export type Origem = "original" | "assessor";
export interface Trecho { texto: string; origem: Origem }

type Grupo = "papel" | Etapa;

interface Def {
  id: string;
  categoria: Categoria;
  grupo: Grupo;
  titulo: string;
  ajuda: string;
  /** Trecho bruto do prompt original, com os separadores (ver a regra no topo do arquivo). */
  bruto: string;
  travado?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Blocos originais. A ordem aqui é a ordem de montagem dentro de cada grupo.
// ---------------------------------------------------------------------------------------------------------------------

const DEFS: Def[] = [
  // ---- PAPEL (categoria geral, vale em todas as etapas) ----
  {
    id: "geral.identidade", categoria: "geral", grupo: "papel", titulo: "Identidade",
    ajuda: "Diz ao Atlas quem ele é e que segue o Método Hunter. Mexa só se quiser mudar a postura de todas as respostas.",
    bruto: "Você é o assistente do assessor Hunter da EQI Investimentos e segue o Método Hunter v5.8. ",
  },
  {
    id: "geral.tom", categoria: "geral", grupo: "papel", titulo: "Tom e linguagem",
    ajuda: "Muda o jeito de escrever em todos os slides: idioma, vocabulário e tamanho das frases.",
    bruto: "Escreva em português do Brasil, direto, no vocabulário do lead, com frases curtas. ",
  },
  {
    id: "geral.compliance", categoria: "geral", grupo: "papel", titulo: "Regras de compliance", travado: true,
    ajuda: "Regras de compliance da EQI. Aparecem só para leitura e valem sempre.",
    bruto: "Regras inegociáveis: nunca prometa rentabilidade; nunca cite produto ou emissor no 'Para' (só classe, subclasse e prazo); " +
      "nunca diga que o lead resolve algo sem o assessor; nunca ataque concorrente pelo nome; não repita CPF, conta ou agência. ",
  },
  {
    id: "geral.numeros", categoria: "geral", grupo: "papel", titulo: "Uso de números",
    ajuda: "Muda como o Atlas trata números: hoje ele usa só os que foram calculados e escreve 'a confirmar' quando falta dado.",
    bruto: "Use SOMENTE números que estejam na lista FATOS. Se faltar dado, escreva 'a confirmar' e não invente. ",
  },
  {
    id: "geral.limites", categoria: "geral", grupo: "papel", titulo: "Limites de caracteres",
    ajuda: "Muda como os textos se ajustam ao espaço de cada campo do slide.",
    bruto: "Respeite os limites de caracteres dos campos: escreva frases COMPLETAS que caibam, sem reticências e sem placeholders como 'R$ X' ou 'a calcular'. ",
  },
  {
    id: "geral.perguntas", categoria: "geral", grupo: "papel", titulo: "Perguntas a partir da R1",
    ajuda: "Muda de onde saem as perguntas para a R2: hoje, das lacunas reais da R1 de cada lead.",
    bruto: "Perguntas devem sair das lacunas reais da R1 deste lead, nunca genéricas.",
  },

  // ---- Leitura da carteira: extrato (TAREFA_ATIVOS) ----
  {
    id: "carteira.classes", categoria: "carteira", grupo: "ativos", titulo: "Classes e subclasses",
    ajuda: "Muda como cada ativo do extrato é classificado, o que altera a carteira atual e a coluna De do De → Para.",
    bruto: "\nTarefa: ler o extrato/carteira e listar cada posição (um item por ativo). " +
      "Classes: Pós-fixado (CDI, Selic, LC, CDB DI, LCI/LCA pós), Pré-fixado, Inflação (IPCA+), Multimercado, " +
      "RF Internacional, RV Internacional, Ações Brasil, FIIs, Alternativos. " +
      "Subclasse (só RF local): Soberano (Tesouro), Bancário com FGC (CDB, LC, LCI, LCA), High Grade (debêntures/CRI/CRA boas), " +
      "High Yield. ",
  },
  {
    id: "carteira.previdencia", categoria: "carteira", grupo: "ativos", titulo: "Previdência",
    ajuda: "Muda se a previdência do lead entra ou não no estudo da carteira.",
    bruto: "Previdência aberta (PGBL/VGBL, fundos de previdência) é patrimônio financeiro e entra no estudo: fora_do_depara=false, classificada pelo que o fundo carrega (use a coluna Classe do relatório quando existir). Só previdência fechada (EFPC), imóvel e participação em empresa: fora_do_depara=true. ",
  },
  {
    id: "carteira.ignorar", categoria: "carteira", grupo: "ativos", titulo: "O que ignorar",
    ajuda: "Muda quais linhas do extrato o Atlas descarta, como totais e cabeçalhos, e o cuidado com dados pessoais.",
    bruto: "Ignore linhas de total, saldo, cabeçalho e rodapé. Não repita CPF ou número de conta.",
  },

  // ---- Leitura da carteira: valores citados na conversa (TAREFA_ATIVOS_TRANSCRICAO) ----
  {
    id: "carteira.transcricao", categoria: "carteira", grupo: "ativos_transcricao", titulo: "Ativos citados na transcrição",
    ajuda: "Muda como o Atlas monta a carteira quando não há extrato e só a fala do lead traz os valores.",
    bruto: "\nTarefa: listar os investimentos que O LEAD diz ter hoje, com o valor que ele cita. Um item por ativo ou classe citada. " +
      "Use só valores ditos na transcrição; não estime nem distribua valores. " +
      "Se o lead cita um total sem dizer onde está, crie um item 'Carteira não detalhada' na classe Pós-fixado. " +
      "Emissor, vencimento e liquidez que não forem ditos ficam 'a confirmar'. " +
      "Ignore valores que o assessor sugere, aportes futuros e metas. Se o lead não cita nenhum valor investido, devolva a lista vazia.",
  },

  // ---- Perfil do lead (TAREFA_LEAD) ----
  {
    id: "lead.citacoes", categoria: "lead", grupo: "lead", titulo: "Perfil e citações literais",
    ajuda: "Muda como o Atlas monta o perfil do lead e quais falas dele viram citação nos slides.",
    bruto: "\n\nTarefa: ler a transcrição da R1 e extrair o perfil do lead. As citações devem ser copiadas literalmente da fala DO LEAD (não do assessor). " +
      "Não invente nada que não esteja na transcrição. Se houver poucas falas do lead, devolva menos citações (até 0), nunca invente. ",
  },
  {
    id: "lead.nome", categoria: "lead", grupo: "lead", titulo: "Nome do lead",
    ajuda: "Muda como o Atlas descobre o primeiro nome do lead, que aparece no título e nos textos do deck.",
    bruto: "primeiro_nome é o nome próprio do lead dito na conversa. Rótulos de fala como 'Lead', 'Cliente' ou 'Assessor' não são nome; se o nome não for dito, deixe vazio.",
  },

  // ---- Proposta De → Para (TAREFA_ALOCACAO) ----
  {
    id: "proposta.partida", categoria: "proposta", grupo: "alocacao", titulo: "Ponto de partida e desvios",
    ajuda: "Muda quanto a proposta pode se afastar do modelo do perfil e que motivo o Atlas precisa dar.",
    bruto: "\n\nTarefa: montar o De → Para por classe. Parta do modelo do perfil, desvie só com motivo ligado ao lead (desvio > 5 p.p. exige motivo). ",
  },
  {
    id: "proposta.percentuais", categoria: "proposta", grupo: "alocacao", titulo: "Percentuais",
    ajuda: "Muda quais classes aparecem no Para e como os percentuais são fechados.",
    bruto: "Liste só classes com percentual > 0. Os percentuais devem somar 100. ",
  },
  {
    id: "proposta.fases", categoria: "proposta", grupo: "alocacao", titulo: "Fases e cards",
    ajuda: "Muda como a proposta é dividida em fases e quantos cards aparecem no slide.",
    bruto: "'fase': 1 = o que fica na liquidez/primeiro movimento, " +
      "2 = renda fixa de prazo, 3 = internacional/risco. Exatamente 3 cards e 3 fases.",
  },

  // ---- Diagnóstico (TAREFA_DIAGNOSTICO) ----
  {
    id: "diagnostico.disse", categoria: "diagnostico", grupo: "diagnostico", titulo: "Disse × números",
    ajuda: "Muda como o Atlas contrapõe o que o lead disse aos números e o que ele acertou.",
    bruto: "\n\nTarefa: montar os textos dos slides de diagnóstico: o que o lead disse × os números (contradição), o que ele acertou, ",
  },
  {
    id: "diagnostico.riscos", categoria: "diagnostico", grupo: "diagnostico", titulo: "Riscos",
    ajuda: "Muda quantos riscos aparecem e como o principal risco escondido é escolhido.",
    bruto: "os 4 riscos (o primeiro é o principal risco escondido), ",
  },
  {
    id: "diagnostico.ganho", categoria: "diagnostico", grupo: "diagnostico", titulo: "Primeiro ganho e o que falta",
    ajuda: "Muda como o Atlas escolhe o primeiro ganho para o lead e o que aponta como faltando na carteira.",
    bruto: "o primeiro ganho (ganho certo, sem risco novo), o que falta na carteira ",
  },
  {
    id: "diagnostico.perguntas", categoria: "diagnostico", grupo: "diagnostico", titulo: "Perguntas",
    ajuda: "Muda quantas perguntas abertas o slide traz e que tipo de pergunta entra.",
    bruto: "e as 5 perguntas que não podem ficar abertas. ",
  },
  {
    id: "diagnostico.frases", categoria: "diagnostico", grupo: "diagnostico", titulo: "Frases do lead no “disse”",
    ajuda: "Muda de onde vêm as frases do slide Disse × números e o que fazer quando o lead falou pouco.",
    bruto: "As frases do 'disse' vêm de frases_literais do lead; se houver menos de 3, devolva só as que existem.",
  },

  // ---- Decisão e resumo (TAREFA_DECISAO) ----
  {
    id: "decisao.decisao", categoria: "decisao", grupo: "decisao", titulo: "A Decisão",
    ajuda: "Muda o texto do slide A Decisão.",
    bruto: "\n\nTarefa: preencher o slide A Decisão, ",
  },
  {
    id: "decisao.resumo", categoria: "decisao", grupo: "decisao", titulo: "Os 6 itens do resumo",
    ajuda: "Muda os itens do slide de Resumo e a ordem em que aparecem.",
    bruto: "o Resumo (6 itens: 1 principal risco escondido, 2 primeiro ganho, 3 o que falta, " +
      "4 o 'Para' em percentuais, 5 primeiros movimentos com datas, 6 acompanhamento) ",
  },
  {
    id: "decisao.frase", categoria: "decisao", grupo: "decisao", titulo: "Frase que o lead repete",
    ajuda: "Muda a frase de fechamento que o lead deve conseguir repetir depois da reunião.",
    bruto: "e a frase que o lead repete (9.9).",
  },

  // ---- Notas do apresentador (TAREFA_NOTAS) ----
  {
    id: "notas.formato", categoria: "notas", grupo: "notas", titulo: "Formato FALAR, PERGUNTAR, NÃO DIZER, VALIDAR",
    ajuda: "Muda a estrutura das notas do apresentador: os marcadores de cada linha e o título de cada bloco.",
    bruto: "\n\nTarefa: escrever o roteiro nas notas do apresentador, um texto por slide, em linhas começando por FALAR:, PERGUNTAR:, " +
      "NÃO DIZER:, VALIDAR: (e a primeira linha com o nome do bloco e o tempo, ex.: 'BLOCO 3 · DISSE × NÚMEROS (4 min)'). ",
  },
  {
    id: "notas.tamanho", categoria: "notas", grupo: "notas", titulo: "Tamanho das notas",
    ajuda: "Muda quantas linhas tem cada nota e que dados do lead entram nelas.",
    bruto: "Cada nota tem 4 a 7 linhas. Use os dados do lead e a lista de pendências a validar antes da R2.",
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// Derivados internos (não exportados): separadores, miolo e grupos.
// ---------------------------------------------------------------------------------------------------------------------

interface Interno { def: Def; antes: string; miolo: string; depois: string }

const separar = (bruto: string): Omit<Interno, "def"> => {
  const antes = /^\s*/.exec(bruto)![0];
  const resto = bruto.slice(antes.length);
  const depois = /[,\s]*$/.exec(resto)![0];
  return { antes, miolo: resto.slice(0, resto.length - depois.length), depois };
};

const INTERNOS: Interno[] = DEFS.map((def) => ({ def, ...separar(def.bruto) }));
const POR_ID = new Map(INTERNOS.map((b) => [b.def.id, b]));
const POR_GRUPO = (g: Grupo) => INTERNOS.filter((b) => b.def.grupo === g);

/** Catálogo exposto à API e à página. `texto` é o miolo editável (sem separadores). */
export const BLOCOS: BlocoBase[] = INTERNOS.map((b) => ({
  id: b.def.id, categoria: b.def.categoria, titulo: b.def.titulo, ajuda: b.def.ajuda, texto: b.miolo, hash: hashBase(b.miolo),
  ...(b.def.travado ? { travado: true } : {}),
}));

/** Base de conhecimento por etapa: cabeçalho do trecho "MÉTODO" e os arquivos (prefixos numéricos, como em `kb(...)`). */
export const KB_DA_ETAPA: Record<Etapa, { cabecalho: string; arquivos: string[] } | null> = {
  ativos: null,
  ativos_transcricao: null,
  lead: { cabecalho: "\n\nMÉTODO (fundamentos e R1):\n", arquivos: ["01", "03"] },
  alocacao: { cabecalho: "\n\nMÉTODO:\n", arquivos: ["05", "02", "04"] },
  diagnostico: { cabecalho: "\n\nMÉTODO:\n", arquivos: ["04", "06", "12"] },
  decisao: { cabecalho: "\n\nMÉTODO (decisão e condução):\n", arquivos: ["06", "07"] },
  notas: { cabecalho: "\n\nMÉTODO (condução):\n", arquivos: ["06"] },
};

const NOME_ARQUIVO_KB: Record<string, string> = {
  "01": "01 Fundamentos",
  "02": "02 Calibragem e faixas",
  "03": "03 R1 Raio-X",
  "04": "04 Diagnóstico da carteira",
  "05": "05 Proposta De → Para",
  "06": "06 R2 condução e pós-reunião",
  "07": "07 Deck oficial R2",
  "12": "12 Aprendizados",
};

const SLIDES: Record<Categoria, { titulo: string; descricao: string; slides: string[] }> = {
  geral: {
    titulo: "Geral", slides: ["Todos os slides"],
    descricao: "Tom, uso de números e regras que valem em todas as etapas.",
  },
  carteira: {
    titulo: "Leitura da carteira", slides: ["Carteira atual", "De → Para (coluna De)", "Carteira montada pela fala do lead"],
    descricao: "Como o Atlas lê os ativos do extrato e, sem extrato, os valores que o lead cita na conversa.",
  },
  lead: {
    titulo: "Perfil do lead", slides: ["Perfil do lead", "Citações do lead"],
    descricao: "Como o Atlas entende quem é o lead e quais falas dele viram citação.",
  },
  proposta: {
    titulo: "Proposta De → Para", slides: ["De → Para", "Fases"],
    descricao: "Como o Atlas monta a proposta: percentuais por classe e fases do plano.",
  },
  diagnostico: {
    titulo: "Diagnóstico", slides: ["Disse × números", "Acertos", "Riscos", "Primeiro ganho", "Perguntas"],
    descricao: "Como o Atlas contrapõe o que o lead disse aos números e aponta riscos, primeiro ganho e perguntas abertas.",
  },
  decisao: {
    titulo: "Decisão e resumo", slides: ["A Decisão", "Resumo", "Frase que o lead repete"],
    descricao: "Como o Atlas escreve a decisão, o resumo de seis itens e a frase que o lead repete.",
  },
  notas: {
    titulo: "Notas do apresentador", slides: ["Notas do apresentador"],
    descricao: "Como o Atlas escreve o roteiro de fala das notas para a R2.",
  },
};

/** Nomes dos arquivos da base usados pelas etapas de uma categoria, sem repetir, na ordem das etapas. */
const referenciaDa = (cat: Categoria): string[] => {
  const nomes: string[] = [];
  for (const e of ETAPAS) {
    if (CATEGORIA_DA_ETAPA[e] !== cat) continue;
    for (const a of KB_DA_ETAPA[e]?.arquivos ?? []) {
      const n = NOME_ARQUIVO_KB[a] ?? a;
      if (!nomes.includes(n)) nomes.push(n);
    }
  }
  return nomes;
};

export const CATEGORIAS_INFO: InfoCategoria[] = CATEGORIAS.map((id) => ({
  id, titulo: SLIDES[id].titulo, descricao: SLIDES[id].descricao, slides: SLIDES[id].slides, referencia: referenciaDa(id),
}));

// ---------------------------------------------------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------------------------------------------------

type Config = Pick<DadosConfig, "alterados" | "extras">;

const alteradoDe = (config: Config | undefined, id: string): BlocoAlterado | undefined => {
  const a = config?.alterados;
  if (!a || !Object.hasOwn(a, id)) return undefined;
  const v = a[id];
  return v && typeof v === "object" ? v : undefined;
};

const TERMINAL = /[.!?:;]$/;

/** Trechos de um grupo (PAPEL ou a TAREFA de uma etapa) conforme a regra de separadores do topo do arquivo. */
function trechosDoGrupo(grupo: Grupo, config?: Config): Trecho[] {
  const todos = POR_GRUPO(grupo);
  if (!todos.length) return [];
  const entrada = todos[0].antes;
  const saida = todos[todos.length - 1].depois;
  const out: Trecho[] = [];
  let anterior: Interno | undefined;
  let ultimo = ""; // texto emitido do último bloco ligado
  for (const b of todos) {
    const alt = b.def.travado ? undefined : alteradoDe(config, b.def.id);
    if (alt && alt.ativo === false) continue;
    const editado = typeof alt?.texto === "string" && alt.texto.trim() !== "" && alt.texto.trim() !== b.miolo;
    const texto = editado ? alt!.texto.trim() : b.miolo;
    let sep: string;
    if (!anterior) sep = entrada;
    else {
      sep = anterior.depois + b.antes;
      if (todos.indexOf(anterior) + 1 !== todos.indexOf(b)) {
        // Houve bloco desligado entre os dois. Se o próximo abre uma frase nova e o anterior não fechou a sua, fecha com ponto.
        if (!TERMINAL.test(ultimo) && /^\p{Lu}/u.test(texto)) sep = "." + anterior.depois.replace(/^,/, "") + b.antes;
        if (sep === "") sep = " ";
      }
    }
    if (sep) out.push({ texto: sep, origem: "original" });
    out.push({ texto, origem: editado ? "assessor" : "original" });
    anterior = b;
    ultimo = texto;
  }
  // Sobrou um bloco do meio no fim (os seguintes foram desligados): fecha a frase se ela terminava em vírgula ou sem pontuação.
  if (anterior && anterior !== todos[todos.length - 1] && !TERMINAL.test(ultimo)) out.push({ texto: ".", origem: "original" });
  if (anterior && saida) out.push({ texto: saida, origem: "original" });
  return out;
}

/** Extras ativos que entram numa etapa: os de "geral" e os da categoria dela, por `ordem` (empate: ordem do array). */
export function extrasDaEtapa(etapa: Etapa, config?: Config): BlocoExtra[] {
  const cat = CATEGORIA_DA_ETAPA[etapa];
  return (config?.extras ?? [])
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x && x.ativo === true && typeof x.texto === "string" && x.texto.trim() !== "" && (x.categoria === "geral" || x.categoria === cat))
    .sort((a, b) => (a.x.ordem - b.x.ordem) || (a.i - b.i))
    .map(({ x }) => x);
}

export const CABECALHO_EXTRAS =
  "\n\nINSTRUÇÕES DO ASSESSOR (complementam o método; não valem sobre as regras inegociáveis nem sobre o formato da resposta):\n";

/** Junta trechos vizinhos de mesma origem e descarta os vazios. */
function compactar(trechos: Trecho[]): Trecho[] {
  const out: Trecho[] = [];
  for (const t of trechos) {
    if (!t.texto) continue;
    const u = out[out.length - 1];
    if (u && u.origem === t.origem) u.texto += t.texto;
    else out.push({ ...t });
  }
  return out;
}

/**
 * System prompt de uma etapa em trechos: PAPEL + (cabeçalho do método + `textoKb`) + TAREFA + extras do assessor.
 * `textoKb` entra no lugar de `kb(...)`: o servidor passa a base inteira, o resumo passa um marcador.
 * Extras: um item "- texto" por instrução (quebras de linha do texto viram "\n  "). O título do extra não vai ao modelo.
 */
export function montarTrechos(etapa: Etapa, config: Config | undefined, textoKb: string): Trecho[] {
  const t: Trecho[] = [...trechosDoGrupo("papel", config)];
  if (KB_DA_ETAPA[etapa]) t.push({ texto: KB_DA_ETAPA[etapa]!.cabecalho + textoKb, origem: "original" });
  t.push(...trechosDoGrupo(etapa, config));
  const extras = extrasDaEtapa(etapa, config);
  if (extras.length) {
    t.push({ texto: CABECALHO_EXTRAS, origem: "original" });
    extras.forEach((x, i) => {
      t.push({ texto: (i ? "\n" : "") + "- ", origem: "original" });
      t.push({ texto: x.texto.trim().replace(/\n/g, "\n  "), origem: "assessor" });
    });
  }
  return compactar(t);
}

/** Texto do PAPEL (geral) com a config opcional. Sem config, é a constante original. */
export const textoPapel = (config?: Config): string => compactar(trechosDoGrupo("papel", config)).map((t) => t.texto).join("");

/** Texto da TAREFA de uma etapa (blocos da categoria dela). Sem config, é a constante original. */
export const textoTarefa = (etapa: Etapa, config?: Config): string => compactar(trechosDoGrupo(etapa, config)).map((t) => t.texto).join("");

const milhares = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Marcador que substitui a base de conhecimento no resumo: "[Método Hunter: 04, 06, 12 · 52.341 caracteres]". */
export function marcadorKb(etapa: Etapa, tamanhoKb?: number): string {
  const kb = KB_DA_ETAPA[etapa];
  if (!kb) return "";
  return `[Método Hunter: ${kb.arquivos.join(", ")}${tamanhoKb && tamanhoKb > 0 ? ` · ${milhares(tamanhoKb)} caracteres` : ""}]`;
}

/**
 * Para a gaveta "Ver prompt final": o mesmo system prompt de `montarSistema`, com a base de conhecimento trocada por um
 * marcador (o navegador não carrega a base). `origem: "assessor"` marca o que veio do assessor (blocos editados e extras).
 * `tamanhoKb` é opcional: sem ele o marcador não mostra o número (o servidor calcula em `tamanhoKb` de prompt-montagem.ts).
 */
export function montarSistemaResumo(etapa: Etapa, config?: Config, tamanhoKb?: number): Trecho[] {
  return montarTrechos(etapa, config, marcadorKb(etapa, tamanhoKb));
}

// ---------------------------------------------------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------------------------------------------------

export type ResultadoValidacao = { ok: true; dados: DadosConfig } | { ok: false; erro: string };

const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ID_EXTRA = /^x_[a-z0-9]{12,32}$/;
const HASH = /^[0-9a-f]{8}$/;
const TITULO_CAT = new Map(CATEGORIAS_INFO.map((c) => [c.id, c.titulo]));

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const limparTexto = (s: string) => s.replace(/\r\n?/g, "\n").replace(CONTROLE, "").trim();
const limparTitulo = (s: string) => s.replace(/\s+/g, " ").replace(CONTROLE, "").trim();
const falha = (erro: string): { ok: false; erro: string } => ({ ok: false, erro });

export function validarConfig(corpo: unknown): ResultadoValidacao {
  if (!ehObjeto(corpo)) return falha("Configuração inválida: o corpo precisa ser um objeto.");
  const { alterados: alt = {}, extras: ext = [] } = corpo;
  if (!ehObjeto(alt)) return falha("Configuração inválida: a lista de blocos alterados está no formato errado.");
  if (!Array.isArray(ext)) return falha("Configuração inválida: a lista de instruções está no formato errado.");

  const alterados: DadosConfig["alterados"] = {};
  for (const [id, v] of Object.entries(alt)) {
    const bloco = POR_ID.get(id);
    if (!bloco) return falha("Um dos blocos alterados não existe mais. Recarregue a página e tente de novo.");
    if (bloco.def.travado) continue; // compliance travado: ignorado, não é erro
    const t = bloco.def.titulo;
    if (!ehObjeto(v)) return falha(`Configuração inválida no bloco "${t}".`);
    if (typeof v.texto !== "string") return falha(`O texto do bloco "${t}" está no formato errado.`);
    if (typeof v.ativo !== "boolean") return falha(`Configuração inválida no bloco "${t}": falta dizer se está ligado.`);
    if (typeof v.baseHash !== "string" || !HASH.test(v.baseHash)) return falha(`Configuração inválida no bloco "${t}": versão do original desconhecida. Recarregue a página.`);
    const texto = limparTexto(v.texto);
    if (!texto) return falha(`O bloco "${t}" não pode ficar vazio. Para tirá-lo do prompt, desligue o bloco.`);
    if (texto.length > LIMITES.textoBloco) return falha(`O bloco "${t}" tem ${milhares(texto.length)} caracteres; o máximo é ${milhares(LIMITES.textoBloco)}.`);
    alterados[id] = { texto, ativo: v.ativo, baseHash: v.baseHash };
  }

  if (ext.length > LIMITES.extras) return falha(`Você pode ter até ${LIMITES.extras} instruções próprias. Apague ou junte algumas.`);
  const extras: BlocoExtra[] = [];
  const vistos = new Set<string>();
  for (const [i, v] of ext.entries()) {
    const n = i + 1;
    if (!ehObjeto(v)) return falha(`Instrução ${n}: formato inválido.`);
    if (typeof v.id !== "string" || !ID_EXTRA.test(v.id)) return falha(`Instrução ${n}: identificador inválido. Recarregue a página e tente de novo.`);
    if (vistos.has(v.id)) return falha(`Instrução ${n}: identificador repetido. Recarregue a página e tente de novo.`);
    vistos.add(v.id);
    if (typeof v.categoria !== "string" || !(CATEGORIAS as readonly string[]).includes(v.categoria)) return falha(`Instrução ${n}: etapa inválida.`);
    if (typeof v.titulo !== "string" || typeof v.texto !== "string") return falha(`Instrução ${n}: título ou texto no formato errado.`);
    if (typeof v.ativo !== "boolean") return falha(`Instrução ${n}: falta dizer se está ligada.`);
    if (typeof v.ordem !== "number" || !Number.isFinite(v.ordem)) return falha(`Instrução ${n}: posição inválida.`);
    const titulo = limparTitulo(v.titulo);
    const texto = limparTexto(v.texto);
    if (!titulo) return falha(`Instrução ${n}: dê um título.`);
    if (titulo.length > LIMITES.tituloBloco) return falha(`O título "${titulo.slice(0, 20)}…" tem ${titulo.length} caracteres; o máximo é ${LIMITES.tituloBloco}.`);
    if (!texto) return falha(`A instrução "${titulo}" está vazia. Escreva o texto ou apague a instrução.`);
    if (texto.length > LIMITES.textoBloco) return falha(`A instrução "${titulo}" tem ${milhares(texto.length)} caracteres; o máximo é ${milhares(LIMITES.textoBloco)}.`);
    extras.push({ id: v.id, categoria: v.categoria as Categoria, titulo, texto, ativo: v.ativo, ordem: v.ordem });
  }

  const soma = (cats: Categoria[]) => extras.filter((x) => x.ativo && cats.includes(x.categoria)).reduce((s, x) => s + x.texto.length, 0);
  const limite = milhares(LIMITES.extrasPorEtapa);
  const g = soma(["geral"]);
  if (g > LIMITES.extrasPorEtapa) return falha(`As suas instruções de "${TITULO_CAT.get("geral")}" passam de ${limite} caracteres (${milhares(g)}). Encurte ou desligue alguma.`);
  for (const cat of new Set(ETAPAS.map((e) => CATEGORIA_DA_ETAPA[e]))) {
    const s = soma(["geral", cat]);
    if (s > LIMITES.extrasPorEtapa)
      return falha(`As suas instruções de "${TITULO_CAT.get(cat)}" somadas às de "${TITULO_CAT.get("geral")}" passam de ${limite} caracteres (${milhares(s)}). Encurte ou desligue alguma.`);
  }
  return { ok: true, dados: { alterados, extras } };
}
