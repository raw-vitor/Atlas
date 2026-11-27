/** `GET/POST /api/conversas/{id}/mensagens`. */
import { conversaRpc, type ConversaRpc } from "./conversaRpc";
import { apagarMensagem, gravarMensagem, listarMensagens, obterMensagemPorIdCliente, POR_PAGINA_MENSAGENS } from "../db/mensagens";
import type { Anexo, PayloadTurno } from "../db/tipos";
import { FORMATOS, MAX_ARQUIVOS, MAX_LOTE_MB, extensaoDe } from "../formatos";
import { chaveDeAnexoValida, nomeDaChave } from "../r2";
import { autenticarConversa, ehResposta, erro, lerJson, protegida } from "./comum";
import { tituloDe } from "./conversas";

/** Teto do texto de uma mensagem. Cabe uma transcrição colada (MAX_TRANSCRICAO_CHARS = 200 mil) e fica abaixo do limite de 2 MB por linha do D1 e do DO. */
export const MAX_TEXTO_MENSAGEM = 300_000;
/** Título automático: os primeiros 60 caracteres do texto (ou o nome do primeiro anexo). */
const TITULO_AUTOMATICO = 60;
const ID_CLIENTE = /^[A-Za-z0-9._-]{1,64}$/;

export function getMensagens(req: Request, id: string, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("mensagens.GET", async () => {
    const a = await autenticarConversa(req, id, injetado);
    if (ehResposta(a)) return a;
    const q = new URL(req.url).searchParams;
    const antesBruto = q.get("antes");
    const limiteBruto = q.get("limite");
    const antes = antesBruto === null ? undefined : Number(antesBruto);
    const limite = limiteBruto === null ? POR_PAGINA_MENSAGENS : Number(limiteBruto);
    if (antes !== undefined && (!Number.isInteger(antes) || antes < 1)) return erro("Parâmetro \"antes\" inválido.", 400);
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) return erro("Parâmetro \"limite\" inválido (1 a 100).", 400);
    return Response.json(await listarMensagens(a.env, a.usuario.id, a.conversa.id, { antes, limite }));
  });
}

/** Confere cada chave (prefixo do usuário e da conversa) e a existência no R2. Devolve os `Anexo` ou a resposta de erro. */
async function resolverAnexos(e: CloudflareEnv, usuarioId: string, conversaId: string, bruto: unknown): Promise<Anexo[] | Response> {
  if (bruto === undefined) return [];
  if (!Array.isArray(bruto)) return erro("Lista de anexos inválida.", 400);
  const chaves = [...new Set(bruto)];
  if (chaves.length > MAX_ARQUIVOS) return erro(`Envie no máximo ${MAX_ARQUIVOS} arquivos por vez.`, 400);
  for (const c of chaves) if (!chaveDeAnexoValida(usuarioId, conversaId, c)) return erro("Anexo inválido.", 400);
  const objetos = await Promise.all((chaves as string[]).map((c) => e.ARQUIVOS.head(c)));
  const anexos: Anexo[] = [];
  for (let i = 0; i < chaves.length; i++) {
    const chave = chaves[i] as string;
    const o = objetos[i];
    const nome = nomeDaChave(chave);
    if (!o) return erro(`O arquivo "${nome}" não chegou ao servidor. Anexe de novo.`, 400);
    anexos.push({ chave, nome, tamanho: o.size, tipo: o.httpMetadata?.contentType || FORMATOS[extensaoDe(nome)]?.mime || "application/octet-stream" });
  }
  if (anexos.reduce((t, x) => t + x.tamanho, 0) > MAX_LOTE_MB * 1024 * 1024) return erro(`O envio passa de ${MAX_LOTE_MB} MB no total.`, 413);
  return anexos;
}

/**
 * Envia uma mensagem. Ordem escolhida para não deixar mensagem órfã: **primeiro a trava, depois a gravação**.
 *   1. `iniciarTarefa("turno")` no DO. Quem perde a corrida recebe 409 sem ter gravado nada (gravar antes e apagar depois deixaria uma
 *      janela em que a lista de mensagens mostra uma mensagem que nunca será processada).
 *   2. grava a mensagem do assessor em D1 com o id já guardado no payload (`mensagemId`);
 *   3. confere que ninguém cancelou nesse intervalo e enfileira.
 * Falha em 2 ou 3 desfaz o que foi feito: libera a trava (`terminarTarefa("erro")`) e apaga a mensagem.
 * Reenvio do mesmo `idCliente` (rede instável, duplo clique) devolve a mensagem já gravada sem pegar outra trava; se a tarefa ainda
 * está `na_fila`, reenfileira (o consumidor descarta duplicatas por `comecarTarefa`, então é seguro e cobre um envio perdido).
 */
export function postMensagens(req: Request, id: string, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("mensagens.POST", async () => {
    const a = await autenticarConversa(req, id, injetado);
    if (ehResposta(a)) return a;
    const { env: e, usuario, conversa } = a;

    const corpo = await lerJson(req);
    if (!corpo) return erro("Não consegui ler a mensagem. Tente de novo.", 400);
    if (typeof corpo.texto !== "string") return erro("Mensagem inválida.", 400);
    const texto = corpo.texto;
    if (texto.length > MAX_TEXTO_MENSAGEM) return erro(`A mensagem passa de ${MAX_TEXTO_MENSAGEM} caracteres. Anexe como arquivo.`, 413);
    const idCliente = corpo.idCliente;
    if (typeof idCliente !== "string" || !ID_CLIENTE.test(idCliente)) return erro("Identificador da mensagem inválido.", 400);
    if (corpo.anexos !== undefined && !Array.isArray(corpo.anexos)) return erro("Lista de anexos inválida.", 400);
    if (!texto.trim() && !(corpo.anexos as unknown[] | undefined)?.length) return erro("Escreva uma mensagem ou anexe um arquivo.", 400);

    const stub = conversaRpc(conversa.id, e);

    const repetida = await obterMensagemPorIdCliente(e, usuario.id, conversa.id, idCliente);
    if (repetida) return respostaDeReenvio(e, stub, conversa.id, usuario.id, repetida);

    const anexos = await resolverAnexos(e, usuario.id, conversa.id, corpo.anexos);
    if (ehResposta(anexos)) return anexos;

    const mensagemId = crypto.randomUUID().replaceAll("-", "");
    const payload: PayloadTurno = { texto, anexos, mensagemId };
    const r = await stub.iniciarTarefa("turno", payload);
    if (!r.ok) {
      if (r.ocupado) return erro("Ainda estou processando a mensagem anterior.", 409, { tarefa: r.tarefa });
      return erro("Conversa não encontrada.", 404);
    }
    const tarefa = r.tarefa;
    const liberar = () => stub.terminarTarefa("erro", { tarefaId: tarefa.id, restaurar: false }).catch(() => undefined);

    let mensagem;
    try {
      mensagem = await gravarMensagem(e, {
        id: mensagemId,
        conversaId: conversa.id,
        tipo: "usuario",
        texto,
        meta: anexos.length ? { anexos } : undefined,
        idCliente,
        titulo: tituloDe(texto, TITULO_AUTOMATICO) || tituloDe(anexos[0]?.nome ?? "", TITULO_AUTOMATICO) || undefined,
      });
    } catch (erroD1) {
      await liberar();
      throw erroD1;
    }
    if (mensagem.id !== mensagemId) {
      // Outra requisição com o mesmo idCliente gravou primeiro (corrida entre a conferência acima e a gravação).
      await liberar();
      return respostaDeReenvio(e, stub, conversa.id, usuario.id, mensagem);
    }

    try {
      if (await stub.cancelado(tarefa.id)) {
        await apagarMensagem(e, conversa.id, mensagem.id);
        return erro("A mensagem foi cancelada antes de começar.", 409);
      }
      await e.TAREFAS.send({ tipo: "turno", conversaId: conversa.id, usuarioId: usuario.id, tarefaId: tarefa.id });
    } catch (erroFila) {
      await apagarMensagem(e, conversa.id, mensagem.id).catch(() => undefined);
      await liberar();
      console.error("[api] não enfileirou o turno", { conversaId: conversa.id, erro: erroFila instanceof Error ? erroFila.name : "desconhecido" });
      return erro("Não consegui colocar a mensagem na fila. Tente de novo.", 503);
    }
    return Response.json({ mensagem, tarefa }, { status: 202 });
  });
}

async function respostaDeReenvio(
  e: CloudflareEnv,
  stub: ConversaRpc,
  conversaId: string,
  usuarioId: string,
  mensagem: Awaited<ReturnType<typeof gravarMensagem>>,
): Promise<Response> {
  const { tarefa } = await stub.estado();
  if (tarefa?.tipo === "turno" && tarefa.status === "na_fila") {
    await e.TAREFAS.send({ tipo: "turno", conversaId, usuarioId, tarefaId: tarefa.id }).catch(() => undefined);
  }
  return Response.json({ mensagem, tarefa }, { status: 202 });
}

