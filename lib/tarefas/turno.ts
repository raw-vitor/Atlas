/**
 * Consumidor do turno de conversa (`{tipo: "turno"}` em atlas-tarefas): a lógica do antigo `POST /api/conversas/{id}/mensagens`
 * fora da requisição. Ordem do corpo:
 *   caso do DO + texto das fontes do R2 -> anexos do R2 -> estimativa do medidor -> `rodarTurno` (publica atividade, texto e caso)
 *   -> medidor real -> mensagem do Atlas em D1 + `mensagem` no SSE -> `salvarCaso` (só se a tarefa seguir ativa) -> o ciclo encerra.
 * A mensagem vem antes do `salvarCaso` de propósito: uma reentrega depois de gravar a mensagem refaz o turno a partir do mesmo
 * caso e a restrição `idCliente` do D1 mantém uma única resposta; o contrário deixaria o caso salvo sem resposta.
 */
import { novoUso } from "../bedrock";
import { checarCancelado } from "../cancelamento";
import { hidratarFontes, obterCaso, salvarCaso } from "../caso";
import { atualizarConversa } from "../db/conversas";
import { apagarMensagem, gravarMensagem } from "../db/mensagens";
import type { PayloadTurno } from "../db/tipos";
import { limiteContexto } from "../modelos";
import type { ContextoTarefa } from "./contexto";
import { executarTarefa, type Tarefa } from "./execucao/ciclo";
import { ErroDeTarefa } from "./execucao/erros";
import { baixarAnexos, criarLeitor } from "./execucao/extracao";
import { rodarTurno } from "./execucao/logica-turno";
import { medirContexto } from "./execucao/medidor";
import type { MensagemTarefa } from "./tipos";

const texto = (x: unknown): x is string => typeof x === "string";

/** O payload que a rota guardou no DO. Anexo com campo faltando invalida tudo: melhor recusar do que ler o arquivo errado. */
export function validarPayloadTurno(p: unknown): PayloadTurno | null {
  if (!p || typeof p !== "object") return null;
  const { texto: t, anexos, mensagemId } = p as Record<string, unknown>;
  if (!texto(t) || !texto(mensagemId) || !mensagemId || !Array.isArray(anexos)) return null;
  for (const a of anexos) {
    if (!a || typeof a !== "object") return null;
    const x = a as Record<string, unknown>;
    if (!texto(x.chave) || !texto(x.nome) || typeof x.tamanho !== "number" || !texto(x.tipo)) return null;
  }
  return { texto: t, anexos: anexos as PayloadTurno["anexos"], mensagemId };
}

async function corpoTurno(t: Tarefa<PayloadTurno>): Promise<void> {
  const { env: e, conversaId, usuarioId, tarefaId } = t;
  const { caso, versao } = await obterCaso(e, conversaId);
  // O texto de uma carteira já lida não volta a ser usado (os ativos ficam no caso): só transcrição, contexto e carteira ainda sem ativos.
  await hidratarFontes(e, usuarioId, conversaId, caso, (f) => f.papel !== "carteira" || !f.ativos);
  const limite = limiteContexto();
  const uso = novoUso();

  // Antes de qualquer chamada ao modelo o medidor só tem a estimativa.
  t.emitir("contexto", medirContexto(caso, 0, limite));
  const arquivos = await baixarAnexos(e, usuarioId, conversaId, t.payload.anexos);
  const { texto: resposta } = await rodarTurno({
    caso, texto: t.payload.texto, arquivos, uso, leitor: criarLeitor(e), enviar: (evento, dados) => t.emitir(evento, dados),
  });
  await t.drenar();
  checarCancelado();

  const contexto = medirContexto(caso, uso.maiorEntrada, limite);
  await t.publicar("contexto", contexto);
  const salva = await gravarMensagem(e, { conversaId, tipo: "atlas", texto: resposta, idCliente: `atlas:${tarefaId}` });
  await atualizarConversa(e, conversaId, { ctxTokens: contexto.tokens, ctxLimite: contexto.limite })
    .catch((x: unknown) => console.error("[turno] não atualizei o medidor em D1", { conversaId, erro: x instanceof Error ? x.name : "desconhecido" }));
  await t.publicar("mensagem", salva);
  const r = await salvarCaso(e, usuarioId, conversaId, caso, { versao, tarefaId });
  if (r.ok) return;
  if (r.motivo === "versao") throw new ErroDeTarefa("A conversa mudou enquanto eu processava a mensagem. Envie de novo.");
  t.abandonar(); // tarefa encerrada por outro caminho ou conversa purgada: o ciclo para sem gravar nada
}

export async function executarTurno(msg: Extract<MensagemTarefa, { tipo: "turno" }>, c: ContextoTarefa): Promise<void> {
  await executarTarefa<PayloadTurno>(msg, c, {
    validar: validarPayloadTurno,
    corpo: corpoTurno,
    // Cancelar volta o caso ao instantâneo (o DO) e a mensagem do assessor some, como se não tivesse sido enviada.
    aoCancelar: (t) => apagarMensagem(t.env, t.conversaId, t.payload.mensagemId),
  });
}
