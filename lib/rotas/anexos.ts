/** `PUT /api/conversas/{id}/anexos?nome=`: o corpo vai direto para o R2, sem montar o arquivo na memória do Worker. */
import { config } from "../config";
import { obterConversa } from "../db/conversas";
import type { Anexo } from "../db/tipos";
import { EXT_OK, FORMATOS, extensaoDe } from "../formatos";
import { chaveAnexo, nomeSeguro } from "../r2";
import { autenticarConversa, ehResposta, erro, protegida } from "./comum";

const MB = 1024 * 1024;
/** Extraídos no Worker (consumidor): limite de 10 MB (docs/FASE0_RELATORIO.md). */
const FORMATOS_DO_WORKER = new Set([".txt", ".md", ".json", ".csv", ".vtt", ".docx", ".odt", ".pptx"]);
/** Limite de entrada do Converse para imagem. */
const FORMATOS_IMAGEM = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const LIMITE_WORKER_MB = 10;
const LIMITE_IMAGEM_MB = 5;

/** Limite em MB por formato: 10 para os que o Worker extrai, 5 para imagem e `MAX_UPLOAD_MB` para pdf, xlsx e xls (extraídos no Container). */
export function limiteAnexoMb(ext: string, maxUploadMb: number): number {
  if (FORMATOS_IMAGEM.has(ext)) return Math.min(LIMITE_IMAGEM_MB, maxUploadMb);
  if (FORMATOS_DO_WORKER.has(ext)) return Math.min(LIMITE_WORKER_MB, maxUploadMb);
  return maxUploadMb;
}

const maxUploadMb = (e: CloudflareEnv) => {
  const n = Number((e.MAX_UPLOAD_MB ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : config.maxUploadMb;
};

const mbTexto = (mb: number) => String(Math.round(mb * 10) / 10).replace(".", ",");

/** Id aleatório de 16 hex (64 bits): único por upload; o hash do conteúdo não existe antes de gravar em streaming. */
const novoIdAnexo = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * O corpo vira um `FixedLengthStream` com o `Content-Length`: o R2 exige tamanho conhecido para streams, e o fluxo recusa mais ou
 * menos bytes que o declarado (um `Content-Length` mentiroso não passa do limite checado antes). Onde `FixedLengthStream` não
 * existe (`next dev`, em Node), lê o corpo para a memória, que é seguro porque o tamanho já foi limitado a `MAX_UPLOAD_MB`.
 */
async function gravar(e: CloudflareEnv, chave: string, req: Request, tamanho: number, mime: string): Promise<"ok" | "interrompido"> {
  const opcoes = { httpMetadata: { contentType: mime } };
  try {
    if (typeof FixedLengthStream !== "undefined" && req.body) {
      const fixo = new FixedLengthStream(tamanho);
      const copia = req.body.pipeTo(fixo.writable);
      copia.catch(() => undefined); // o erro aparece no put; evita rejeição sem tratamento
      await e.ARQUIVOS.put(chave, fixo.readable, opcoes);
      await copia;
    } else {
      const bytes = await req.arrayBuffer();
      if (bytes.byteLength !== tamanho) return "interrompido";
      await e.ARQUIVOS.put(chave, bytes, opcoes);
    }
    return "ok";
  } catch (falha) {
    // Corpo menor/maior que o declarado ou conexão cortada: o R2 não grava o objeto. Erro do próprio R2 sobe como 500.
    if (req.signal.aborted || (falha instanceof Error && /length|stream|abort|disconnect|body/i.test(falha.message))) return "interrompido";
    throw falha;
  }
}

export function putAnexo(req: Request, id: string, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("anexos.PUT", async () => {
    const a = await autenticarConversa(req, id, injetado);
    if (ehResposta(a)) return a;
    const { env: e, usuario, conversa } = a;

    const bruto = new URL(req.url).searchParams.get("nome") ?? "";
    if (!bruto.trim() || bruto.length > 255) return erro("Informe o nome do arquivo.", 400);
    const nome = nomeSeguro(bruto);
    const ext = extensaoDe(nome);
    if (!EXT_OK.includes(ext)) return erro(`"${nome}": formato não aceito. Envie ${EXT_OK.join(", ")}.`, 415);

    const cabecalho = req.headers.get("content-length");
    if (cabecalho === null || !/^\d{1,15}$/.test(cabecalho)) return erro("O envio precisa informar o tamanho do arquivo (Content-Length).", 411);
    const tamanho = Number(cabecalho);
    if (tamanho === 0 || !req.body) return erro(`"${nome}" está vazio.`, 400);
    const limite = limiteAnexoMb(ext, maxUploadMb(e));
    if (tamanho > limite * MB) return erro(`"${nome}" passa de ${mbTexto(limite)} MB.`, 413);

    const mime = FORMATOS[ext].mime;
    const chave = chaveAnexo(usuario.id, conversa.id, novoIdAnexo(), nome);
    if ((await gravar(e, chave, req, tamanho, mime)) === "interrompido") {
      return erro("O envio foi interrompido ou chegou diferente do tamanho informado. Tente de novo.", 400);
    }
    // A conversa pode ter sido apagada durante o upload; sem isto o objeto ficaria órfão no prefixo já purgado.
    if (!(await obterConversa(e, usuario.id, conversa.id))) {
      await e.ARQUIVOS.delete(chave);
      return erro("Conversa não encontrada.", 404);
    }
    const anexo: Anexo = { chave, nome, tamanho, tipo: mime };
    return Response.json({ anexo }, { status: 201 });
  });
}
