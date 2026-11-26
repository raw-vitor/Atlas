// Porte de packages/domain-kernel/src/classificacao-documento.ts (eqi-hackathon-r2-automated, a9fbd07).
// Classificação de documento por CONTEÚDO.
//
// A extensão é um palpite ruim: um extrato exportado em .docx vira
// "transcrição" e segue para o prompt de relatório de R1 — não produz ativo
// nenhum e a carteira fica vazia SEM ERRO. Ao contrário, uma transcrição
// salva em .pdf vai para o extrator de carteira e devolve lixo marcado para
// revisão. Nos dois casos o job chega a ready_for_review e só o assessor,
// olhando a tela de ativos, percebe.
//
// Determinístico de propósito: sinais contáveis, sem LLM. Isomórfico de
// propósito também: roda no worker (sobre texto já anonimizado pela Lambda
// de OCR ou extraído localmente) e no navegador, ANTES do upload — é o
// mesmo juízo nos dois lugares, e duas cópias divergiriam em silêncio.
// Em qualquer dos dois, o texto está dentro do perímetro (ADR-001): no
// browser ele nem saiu da máquina do assessor.

export type Papel = "carteira" | "transcricao";

export interface Classificacao {
  readonly papel: Papel;
  // 0..1. Abaixo de CONFIANCA_MINIMA quem chama MANTÉM o palpite da extensão:
  // trocar no escuro é pior que errar previsivelmente.
  readonly confianca: number;
  // Por que decidiu assim — vai para o log e para o aviso da tela.
  readonly sinais: readonly string[];
}

// Margem mínima entre os dois lados para a troca valer. Calibrado para que
// um documento misto (ata de reunião que cita valores) não oscile.
export const CONFIANCA_MINIMA = 0.6;
// Pontuação do lado vencedor abaixo disto reduz a confiança proporcionalmente.
const FORCA_MINIMA = 0.3;

// Cue de legenda: "00:01:23.456 --> 00:01:25.000". É a assinatura mais forte
// que existe — nenhum extrato tem isso.
const CUE_VTT = /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}\s*-->\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}/m;
const CABECALHO_VTT = /^\s*WEBVTT/;

// "Fulano:" no início da linha — a marca de diálogo transcrito. Aceita um
// timestamp antes do nome ("[00:00:12] Ana:", "(00:12) Ana:", "00:12 - Ana:"),
// formato comum de transcrição exportada do Meet/Teams para .docx. Sem ele,
// uma transcrição inteira contava UMA fala (só a linha sem horário) e perdia
// para os produtos citados na conversa — virava extrato.
const FALA =
  /^\s*(?:[[(]?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?[\])]?\s*(?:[-–—]\s*)?)?[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\wÀ-ÿ .'-]{1,40}:\s+\S/gm;

// Divergência da referência: transcrição exportada do Teams/Meet em .txt traz "Nome   0:08" (nome e horário
// na mesma linha, a fala na seguinte), sem dois-pontos. Sem este padrão a transcrição do caso Elisandro
// contava zero falas e perdia para os produtos citados na conversa.
// O .docx lido pelo mammoth cola o horário na fala ("Nome   0:08Opa, bom dia"), então o fim de linha não pode ser exigido.
const FALA_COM_HORARIO = /^\s*[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\wÀ-ÿ .'-]{1,60}\s+(?:\d{1,2}:)?\d{1,2}:\d{2}(?!\d)/gm;

// R$ 1.234.567,89 — com ou sem o símbolo, mas sempre com centavos.
const VALOR_BRL = /(?:R\$\s*)?\d{1,3}(?:\.\d{3})+,\d{2}\b/g;
const INDEXADOR = /\b\d{1,3}(?:,\d+)?\s*%\s*(?:do\s+)?(?:CDI|a\.a\.|ao\s+ano)|\bIPCA\s*\+/gi;
const PRODUTO =
  /\b(CDB|LCI|LCA|LCD|CRI|CRA|COE|FIDC|FII|FIC\s+FIM|FIC\s+FIA|ETF|VGBL|PGBL|deb[eê]ntures?|tesouro\s+(?:selic|prefixado|ipca)|renda\s+fixa|renda\s+vari[aá]vel)\b/gi;
const VOCABULARIO_CUSTODIA =
  /\b(posi[cç][aã]o\s+consolidada|cust[oó]dia|saldo\s+bruto|vencimento|liquidez|emissor|aplica[cç][aã]o|patrim[oô]nio\s+total)\b/gi;

function contar(texto: string, padrao: RegExp): number {
  return (texto.match(padrao) ?? []).length;
}

// Normaliza uma contagem para 0..1 — `saturacao` é quantas ocorrências já
// significam "muito". Evita que um documento gigante vença só por tamanho.
function intensidade(ocorrencias: number, saturacao: number): number {
  return Math.min(1, ocorrencias / saturacao);
}

export function classificarPorConteudo(texto: string): Classificacao {
  const amostra = texto.slice(0, 20_000);
  const sinais: string[] = [];

  // Atalho: cue de legenda não acontece por acaso.
  if (CUE_VTT.test(amostra) || CABECALHO_VTT.test(amostra)) {
    return { papel: "transcricao", confianca: 1, sinais: ["cue_de_legenda"] };
  }

  const falas = contar(amostra, FALA) + contar(amostra, FALA_COM_HORARIO);
  const valores = contar(amostra, VALOR_BRL);
  const indexadores = contar(amostra, INDEXADOR);
  const produtos = contar(amostra, PRODUTO);
  const custodia = contar(amostra, VOCABULARIO_CUSTODIA);

  if (falas > 0) sinais.push(`falas:${falas}`);
  if (valores > 0) sinais.push(`valores:${valores}`);
  if (indexadores > 0) sinais.push(`indexadores:${indexadores}`);
  if (produtos > 0) sinais.push(`produtos:${produtos}`);
  if (custodia > 0) sinais.push(`custodia:${custodia}`);

  // Extrato: muitos valores + vocabulário de produto/custódia. Um extrato de
  // meia dúzia de linhas já satura.
  // Sem valor em R$ com centavos o texto não é um extrato: uma conversa sobre CDB também cita produto, liquidez e vencimento.
  const fatorValores = 0.3 + 0.7 * intensidade(valores, 3);
  const pontosExtrato = fatorValores * (
    intensidade(valores, 8) * 0.4 +
    intensidade(produtos, 4) * 0.3 +
    intensidade(indexadores, 3) * 0.15 +
    intensidade(custodia, 4) * 0.15);

  // Transcrição: diálogo. Valor citado numa conversa é comum, então o peso
  // é da fala, não da ausência de números.
  const pontosTranscricao = intensidade(falas, 12);

  const total = pontosExtrato + pontosTranscricao;
  if (total === 0) {
    return { papel: "carteira", confianca: 0, sinais: ["sem_sinal"] };
  }

  const papel: Papel = pontosExtrato >= pontosTranscricao ? "carteira" : "transcricao";
  // A razão sozinha dá 1 quando só um lado pontua, mesmo com sinal fraco. A força absoluta também conta.
  const forca = Math.max(pontosExtrato, pontosTranscricao);
  const confianca = (forca / total) * Math.min(1, forca / FORCA_MINIMA);
  return { papel, confianca, sinais };
}

// Classificação por NOME do arquivo — o degrau entre o conteúdo e a extensão.
//
// A extensão sozinha é quase um sorteio: ".docx = transcrição" existe porque
// transcrição de Meet/Teams costuma sair em .docx, mas extrato de corretora
// exportado em .docx é igualmente comum, e aí o arquivo segue por um ramo do
// pipeline que não produz ativo nenhum. O nome, ao contrário, quase sempre
// diz: "Extrato XP 01-2026.docx", "Reuniao Carmen 12-11.docx".
//
// É um degrau fraco de propósito — nome é convenção, não evidência. Só vale
// quando o CONTEÚDO não decidiu (ou não há texto legível), nunca contra ele.
// Palavra que aparece dos dois lados ("relatório", "investimentos", "cliente")
// fica fora: ela estaria nos dois nomes e decidiria no cara ou coroa.

// Prefixo de token: pega plural, flexão e nome colado ("reunioes",
// "custodiaxp", "consolidada").
const PREFIXOS_TRANSCRICAO = ["transcri", "transcript", "reuni", "meeting", "entrevista", "conversa", "gravac", "gravad"];

const PREFIXOS_CARTEIRA = [
  "extrato",
  "posicao",
  "posicoes",
  "carteira",
  "custodia",
  "consolidad",
  "patrimonio",
  "aplicacoes",
  "portfolio",
  "bradesco",
  "santander",
  "nuinvest",
];

// Palavra curta casa só INTEIRA: por prefixo, "ata" acharia "atacado", "xp"
// acharia "experiencia" e "inter" acharia "internacional" — todos
// classificando ao contrário.
const TOKENS_TRANSCRICAO = ["ata", "atas", "call", "calls", "meet", "teams", "zoom", "r1", "audio"];

const TOKENS_CARTEIRA = ["saldo", "xp", "btg", "itau", "safra", "rico", "clear", "avenue", "inter", "warren", "b3"];

// "Extrato_XP 01-2026 (1).docx" -> ["extrato", "xp", "01", "2026", "1"]. A
// extensão sai junto: ".doc" não pode valer como a palavra "doc".
function tokensDoNome(nomeDoArquivo: string): string[] {
  const semExtensao = nomeDoArquivo.replace(/\.[a-z0-9]{1,5}$/i, "");
  return semExtensao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function contarSinaisDoNome(
  tokens: readonly string[],
  prefixos: readonly string[],
  exatos: readonly string[],
): number {
  return tokens.filter(
    (token) => exatos.includes(token) || prefixos.some((prefixo) => token.startsWith(prefixo)),
  ).length;
}

// null = o nome não diz nada, ou diz as duas coisas ("Extrato citado na
// reunião"). Quem chama mantém o palpite que já tinha.
export function classificarPorNome(nomeDoArquivo: string): Classificacao | null {
  const tokens = tokensDoNome(nomeDoArquivo);
  const transcricao = contarSinaisDoNome(tokens, PREFIXOS_TRANSCRICAO, TOKENS_TRANSCRICAO);
  const carteira = contarSinaisDoNome(tokens, PREFIXOS_CARTEIRA, TOKENS_CARTEIRA);
  if (transcricao === carteira) return null;

  const papel: Papel = carteira > transcricao ? "carteira" : "transcricao";
  return {
    papel,
    confianca: Math.max(transcricao, carteira) / (transcricao + carteira),
    sinais: [`nome:${papel}`],
  };
}

export type OrigemDaClassificacao = "usuario" | "conteudo" | "nome" | "extensao" | "sem_leitura";

export interface Triagem {
  readonly papel: Papel;
  readonly origem: OrigemDaClassificacao;
  readonly confianca: number;
  readonly sinais: readonly string[];
  /** true = houve leitura e ela ficou ambígua; só estes vão para o desempate. */
  readonly incerto: boolean;
}

/** Escada da referência (triagem.ts): conteúdo (>= 0,6), nome, extensão. `texto` null = sem leitura. */
export function triar(params: { nome: string; texto: string | null; palpiteDaExtensao: Papel }): Triagem {
  const { nome, texto, palpiteDaExtensao } = params;
  const peloNome = classificarPorNome(nome);
  const doNome = (extra: readonly string[]): Triagem => ({
    papel: peloNome!.papel, origem: "nome", confianca: peloNome!.confianca, sinais: [...peloNome!.sinais, ...extra], incerto: false,
  });
  if (texto === null) {
    if (peloNome) return doNome(["sem_texto_local"]);
    return { papel: palpiteDaExtensao, origem: "sem_leitura", confianca: 0, sinais: ["sem_texto_local"], incerto: false };
  }
  const c = classificarPorConteudo(texto);
  if (c.confianca >= CONFIANCA_MINIMA) return { papel: c.papel, origem: "conteudo", confianca: c.confianca, sinais: c.sinais, incerto: false };
  if (peloNome) return doNome(c.sinais);
  return { papel: palpiteDaExtensao, origem: "extensao", confianca: c.confianca, sinais: c.sinais, incerto: true };
}
