/**
 * Anexos do turno: baixa do R2 e converte em texto.
 *
 * - `.txt .md .json .csv .vtt .docx .odt .pptx` (até 10 MB): em processo, com `lib/ingest.ts`.
 * - `.pdf .xlsx .xls`: no Container `EXTRATOR` (docs/FASE0_RELATORIO.md: o xlsx de 25 MB chega a 1,4 GB de RSS).
 * - Imagens (até 5 MB, o limite do Converse): `lib/ingest.ts` repassa os bytes ao Bedrock.
 * Nada do conteúdo vai para o log.
 */
import type { LeitorDeArquivo } from "../../chat";
import { CanceladoError, esperar, sinalAtual } from "../../cancelamento";
import type { Anexo } from "../../db/tipos";
import { extensaoDe } from "../../formatos";
import { toText } from "../../ingest";
import { chaveDeAnexoValida } from "../../r2";

export const EXT_CONTAINER = new Set([".pdf", ".xlsx", ".xls"]);
const EXT_IMAGEM = new Set([".png", ".jpg", ".jpeg", ".webp"]);
export const MAX_WORKER_MB = 10;
export const MAX_IMAGEM_MB = 5;
const INSTANCIA_EXTRATOR = "pool-0";
/** Tentativas além da primeira para falha de rede ou 5xx do Container (partida a frio, reinício). */
const REPETICOES = 2;

/** Falha que repetir não resolve (arquivo ilegível, formato recusado): a mensagem vai para a tela. */
class ErroDefinitivo extends Error {}

export interface ArquivoBaixado { nome: string; buf: Buffer }

/**
 * Baixa os anexos do R2, um por vez, conferindo que cada chave é desta conversa deste usuário (o payload vem do DO, mas a chave
 * é conferida mesmo assim). Anexo ausente lança com texto para a tela: seguir sem ele mudaria o que o assessor enviou.
 */
export async function baixarAnexos(e: CloudflareEnv, usuarioId: string, conversaId: string, anexos: Anexo[]): Promise<ArquivoBaixado[]> {
  const saida: ArquivoBaixado[] = [];
  for (const a of anexos) {
    if (!chaveDeAnexoValida(usuarioId, conversaId, a.chave)) throw new Error(`Não consegui abrir o anexo "${a.nome}". Anexe de novo.`);
    const o = await e.ARQUIVOS.get(a.chave);
    if (!o) throw new Error(`Não encontrei o anexo "${a.nome}". Anexe de novo.`);
    saida.push({ nome: a.nome, buf: Buffer.from(await o.arrayBuffer()) });
  }
  return saida;
}

/** Leitor de arquivos para `interpretar`: escolhe entre o Worker, o Container e o Bedrock pela extensão e pelo tamanho. */
export function criarLeitor(e: CloudflareEnv): LeitorDeArquivo {
  return async (nome, buf, uso) => {
    const ext = extensaoDe(nome);
    if (EXT_CONTAINER.has(ext)) return extrairNoContainer(e, nome, buf);
    const maxMb = EXT_IMAGEM.has(ext) ? MAX_IMAGEM_MB : MAX_WORKER_MB;
    if (buf.length > maxMb * 1024 * 1024) throw new Error(`passa de ${maxMb} MB, o limite para este formato`);
    return toText(nome, buf, uso);
  };
}

const textoDoErro = async (r: Response, padrao: string): Promise<string> => {
  try {
    const j = (await r.json()) as { erro?: unknown };
    return typeof j.erro === "string" && j.erro ? j.erro.slice(0, 300) : padrao;
  } catch { return padrao; }
};

/** `POST /extrair` no Container. 422 e 4xx são definitivos; rede e 5xx repetem com espera (que o cancelamento interrompe). */
export async function extrairNoContainer(e: CloudflareEnv, nome: string, buf: Buffer): Promise<string> {
  let ultimo = "";
  for (let tentativa = 0; tentativa <= REPETICOES; tentativa++) {
    try {
      const stub = e.EXTRATOR.get(e.EXTRATOR.idFromName(INSTANCIA_EXTRATOR));
      const r = await stub.fetch(new Request(`http://extrator/extrair?nome=${encodeURIComponent(nome)}`, {
        method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength), signal: sinalAtual(),
      }));
      if (r.ok) {
        const { texto } = (await r.json()) as { texto?: unknown };
        if (typeof texto !== "string") throw new Error("resposta do extrator sem texto");
        return texto;
      }
      if (r.status >= 400 && r.status < 500) throw new ErroDefinitivo(await textoDoErro(r, "Não consegui extrair o texto do arquivo"));
      ultimo = `HTTP ${r.status}`;
    } catch (erro) {
      if (erro instanceof ErroDefinitivo) throw erro;
      if (sinalAtual()?.aborted) throw new CanceladoError();
      ultimo = erro instanceof Error ? erro.name : "desconhecido";
    }
    if (tentativa < REPETICOES) await esperar(2000 * (tentativa + 1));
  }
  console.error("[extracao] extrator indisponível", { erro: ultimo });
  throw new Error("o serviço de leitura de PDF e planilha não respondeu");
}
