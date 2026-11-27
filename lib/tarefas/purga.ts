import { conversaRpc } from "../rotas/conversaRpc";
import { apagarLinhas, linhaParaPurga } from "../db/conversas";
import { apagarPrefixo, chaveConversa } from "../r2";
import type { ContextoTarefa } from "./contexto";
import type { MensagemTarefa } from "./tipos";

/**
 * Apaga de fato uma conversa: cancela a tarefa em andamento, chama `purgar()` no DO, remove o prefixo `u/{usuarioId}/c/{conversaId}/`
 * do R2 e apaga as linhas de D1. Idempotente: a fila entrega pelo menos uma vez e o cron refaz as pendentes.
 *
 * Só age em conversa marcada como `apagada` em D1 (ou cuja linha já não existe, para terminar uma purga interrompida depois do último
 * passo). Mensagem de purga para uma conversa ativa é ignorada: nunca apaga uma conversa que o assessor ainda vê.
 *
 * Ordem: cancelar, DO, R2, D1. O DO vai antes do R2 (o contrato sugeria R2 primeiro) porque depois de `purgar()` o consumidor de uma
 * tarefa em andamento perde o `batimento` e as escritas no DO, e para de gravar; com o R2 primeiro, ele poderia gravar uma fonte nova no
 * prefixo já limpo. Se qualquer passo falhar, a linha de D1 com `apagada` continua e o passo é refeito (fila: reentrega; depois, cron).
 * O que ainda escapar (upload em voo, consumidor que não parou a tempo) é varrido pela regra de ciclo de vida de 90 dias do bucket.
 */
export async function executarPurga(msg: Extract<MensagemTarefa, { tipo: "purga" }>, c: ContextoTarefa): Promise<void> {
  const e = c.env;
  const linha = await linhaParaPurga(e, msg.conversaId);
  if (linha && linha.apagada === null) {
    console.error("[tarefa] purga ignorada: conversa ativa", { conversaId: msg.conversaId });
    return;
  }
  // Com a linha, o dono vem de D1; sem ela (purga já concluída antes), da mensagem, que só leva ids gerados pelo próprio servidor.
  const usuarioId = linha?.usuarioId ?? msg.usuarioId;
  if (linha && linha.usuarioId !== msg.usuarioId) {
    console.error("[tarefa] purga ignorada: dono diferente", { conversaId: msg.conversaId });
    return;
  }

  const stub = conversaRpc(msg.conversaId, e);
  await stub.cancelar();
  await stub.purgar();
  const apagados = await apagarPrefixo(e.ARQUIVOS, chaveConversa(usuarioId, msg.conversaId));
  await apagarLinhas(e, msg.conversaId);
  console.log("[tarefa] purga concluída", { conversaId: msg.conversaId, objetos: apagados, tentativa: c.tentativa });
}
