/** Caso público de uma conversa a partir do que o DO guarda (JSON puro, sem o texto das fontes) e do R2. */
import { casoAvulso, publicoCaso, type Caso, type CasoPublico } from "../caso";
import { conversaRpc } from "./conversaRpc";
import { chaveFonte } from "../r2";
import type { TarefaPublica } from "../tarefas/tipos";

/**
 * O DO não guarda o texto das fontes (uma transcrição chega a 200 mil caracteres): ele fica em R2 em `fontes/{hash}.txt`. O estado público
 * calcula avisos e opções a partir do texto das transcrições, então só estas são relidas. Texto ausente em R2 vira vazio.
 */
async function hidratarTranscricoes(e: CloudflareEnv, usuarioId: string, conversaId: string, caso: Caso): Promise<void> {
  await Promise.all(
    caso.fontes.map(async (f) => {
      if (typeof f.texto === "string") return;
      if (f.papel !== "transcricao" || typeof f.hash !== "string") { f.texto = ""; return; }
      const o = await e.ARQUIVOS.get(chaveFonte(usuarioId, conversaId, f.hash));
      f.texto = o ? await o.text() : "";
    }),
  );
}

/** Caso do DO (ou um caso vazio, numa conversa que ainda não recebeu nada) já em formato público. `ocupado` vem da tarefa, não do caso. */
export async function casoPublicoDe(
  e: CloudflareEnv,
  usuarioId: string,
  conversaId: string,
  tarefa: TarefaPublica | null,
  casoDoDo?: unknown,
): Promise<CasoPublico> {
  const salvo = casoDoDo === undefined ? (await conversaRpc(conversaId, e).obterCaso()).caso : casoDoDo;
  const caso: Caso = salvo ? (salvo as Caso) : { ...casoAvulso(), id: conversaId };
  await hidratarTranscricoes(e, usuarioId, conversaId, caso);
  return { ...publicoCaso(caso), ocupado: tarefa?.status === "na_fila" || tarefa?.status === "rodando" };
}

export const tarefaAtiva = (t: TarefaPublica | null | undefined): t is TarefaPublica => t?.status === "na_fila" || t?.status === "rodando";
