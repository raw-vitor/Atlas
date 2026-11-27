/**
 * Ciclo de vida de uma tarefa do consumidor (turno ou deck): o que não depende do que a tarefa faz.
 *
 *   espera vaga no isolate (publica `fila`) -> comecarTarefa (descarta duplicata e tarefa encerrada) -> batimento a cada
 *   `config.batimentoMs` -> corpo da tarefa dentro do contexto de cancelamento -> terminarTarefa.
 *
 * Desfechos:
 * - corpo termina: `concluida`.
 * - cancelamento (marca vista no batimento): aborta o `AbortController`, o que corta o `fetch` em andamento (Bedrock, deck,
 *   extrator); `aoCancelar` desfaz o que a tarefa gravou fora do DO; `terminarTarefa("cancelada")` restaura o caso.
 * - tarefa que o DO já encerrou por outro caminho (cancelada na fila, lease vencido, purga): para sem gravar nada.
 * - qualquer outro erro: mensagem amigável gravada em D1 (meta.erro), `erro` no SSE e `terminarTarefa("erro", {restaurar: true})`.
 * Falha de infraestrutura antes de começar ou ao encerrar sobe para a fila reentregar (o DO distingue a reentrega da duplicata).
 */
import { CanceladoError, comCancelamento } from "../../cancelamento";
import { conversaDo } from "../../cf";
import { config } from "../../config";
import { gravarMensagem } from "../../db/mensagens";
import type { ContextoTarefa } from "../contexto";
import type { MensagemTarefa, ResultadoComecar, StatusFinal } from "../tipos";
import type { ResultadoTerminar } from "../../../workers/conversa";
import { classeDoErro, ErroDeTarefa, mensagemDeErro } from "./erros";
import { semaforoDoIsolate } from "./limite";

/**
 * O Durable Object com o que o consumidor chama. O stub gerado (`DurableObjectStub<Conversa>`) tipa como `never` o retorno dos métodos
 * cujo resultado tem campo `unknown` (`payload`), então esta interface repete as assinaturas de `workers/conversa.ts` que o ciclo usa.
 */
export interface ConversaDoConsumidor {
  comecarTarefa(tarefaId: string, tentativa: number): Promise<ResultadoComecar>;
  batimento(tarefaId: string): Promise<{ ativa: boolean; cancelada: boolean }>;
  publicar(evento: string, dados: unknown, tarefaId?: string): Promise<number | null>;
  terminarTarefa(status: StatusFinal, opcoes?: { tarefaId?: string; restaurar?: boolean; erro?: string }): Promise<ResultadoTerminar>;
}

export type MensagemDeTarefa = Extract<MensagemTarefa, { tipo: "turno" | "deck" }>;

export interface Tarefa<P> {
  readonly env: CloudflareEnv;
  readonly conversaId: string;
  readonly usuarioId: string;
  readonly tarefaId: string;
  readonly tentativa: number;
  readonly payload: P;
  readonly signal: AbortSignal;
  readonly stub: ConversaDoConsumidor;
  /** Publica um evento da tarefa e espera o DO gravar. Se a tarefa não estiver mais ativa, aborta o fluxo e lança `CanceladoError`. */
  publicar(evento: string, dados: unknown): Promise<void>;
  /** Para callbacks síncronos de progresso: publica em ordem, sem esperar; falha de rede no progresso não derruba a tarefa. */
  emitir(evento: string, dados: unknown): void;
  /** Espera as publicações pendentes de `emitir`. */
  drenar(): Promise<void>;
  /** O DO já encerrou esta tarefa (ou a conversa foi purgada): para sem gravar nada e sem tocar na tarefa. Nunca retorna. */
  abandonar(): never;
}

export interface OpcoesTarefa<P> {
  /** Valida o payload guardado no DO. Devolve null se o formato não for o esperado. */
  validar(payload: unknown): P | null;
  /** O corpo. Faz o commit (D1, R2, `salvarCaso`) ao final e publica `mensagem`; o ciclo só encerra a tarefa. */
  corpo(t: Tarefa<P>): Promise<void>;
  /** Cancelamento: desfaz o que não é do DO (a mensagem do assessor em D1). O DO restaura o caso. */
  aoCancelar?(t: Tarefa<P>): Promise<void>;
}

const MSG_PAYLOAD = "Não consegui ler o pedido desta tarefa. Envie de novo.";
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `terminarTarefa` repetido com espera curta: falhar aqui depois de gravar tudo faria a fila reexecutar a tarefa inteira. */
async function terminar(stub: ConversaDoConsumidor, status: StatusFinal, opcoes: { tarefaId: string; restaurar?: boolean; erro?: string }) {
  for (let i = 0; ; i++) {
    try { return await stub.terminarTarefa(status, opcoes); }
    catch (e) { if (i >= 2) throw e; await dormir(500 * (i + 1)); }
  }
}

export async function executarTarefa<P>(msg: MensagemDeTarefa, c: ContextoTarefa, o: OpcoesTarefa<P>): Promise<void> {
  const { env: e } = c;
  const stub = conversaDo(msg.conversaId, e) as unknown as ConversaDoConsumidor;
  const base = { tipo: msg.tipo, conversaId: msg.conversaId, tarefaId: msg.tarefaId };

  // Vaga no isolate. Enquanto espera, a tarefa segue `na_fila` no DO (dá para cancelar) e o assessor vê a posição.
  const liberar = await semaforoDoIsolate(config.tarefasPorIsolate).adquirir((posicao) => {
    void stub.publicar("fila", { posicao }, msg.tarefaId).catch(() => undefined);
  });
  const ac = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const inicio = await stub.comecarTarefa(msg.tarefaId, c.tentativa);
    if (!inicio.ok) {
      // Duplicata, tarefa já encerrada (cancelada na fila, expirada, concluída antes de um ack perdido) ou conversa purgada.
      console.log("[tarefa] ignorada", { ...base, motivo: inicio.motivo, tentativa: c.tentativa });
      return;
    }

    const estado = { perdida: false, cancelada: false };
    let emBatimento = false;
    timer = setInterval(() => {
      if (emBatimento) return;
      emBatimento = true;
      stub.batimento(msg.tarefaId)
        .then((b) => {
          if (!b.ativa) { estado.perdida = true; ac.abort(); }
          else if (b.cancelada && !estado.cancelada) { estado.cancelada = true; ac.abort(); }
        })
        .catch(() => undefined) // falha passageira: o próximo batimento tenta de novo (o lease é de 20 min)
        .finally(() => { emBatimento = false; });
    }, config.batimentoMs);

    let cadeia: Promise<void> = Promise.resolve();
    const tarefa: Tarefa<P> | null = (() => {
      const payload = o.validar(inicio.payload);
      if (payload === null) return null;
      const t: Tarefa<P> = {
        env: e, conversaId: msg.conversaId, usuarioId: msg.usuarioId, tarefaId: msg.tarefaId, tentativa: c.tentativa, payload,
        signal: ac.signal, stub,
        abandonar() { estado.perdida = true; ac.abort(); throw new CanceladoError(); },
        async publicar(evento, dados) {
          const id = await stub.publicar(evento, dados, msg.tarefaId);
          if (id === null) t.abandonar();
        },
        emitir(evento, dados) {
          cadeia = cadeia.then(() => t.publicar(evento, dados)).catch(() => undefined);
        },
        drenar: () => cadeia,
      };
      return t;
    })();

    try {
      if (!tarefa) throw new ErroDeTarefa(MSG_PAYLOAD);
      await comCancelamento(ac.signal, () => o.corpo(tarefa));
      await terminar(stub, "concluida", { tarefaId: msg.tarefaId });
    } catch (erro) {
      await tarefa?.drenar(); // o progresso já emitido chega ao DO antes de `erro`/`fim`, na ordem em que foi gerado
      if (estado.perdida) { console.log("[tarefa] encerrada pelo DO durante a execução", base); return; }
      if (estado.cancelada || erro instanceof CanceladoError || ac.signal.aborted) {
        if (tarefa) await o.aoCancelar?.(tarefa).catch((x: unknown) => console.error("[tarefa] aoCancelar falhou", { ...base, erro: x instanceof Error ? x.name : "desconhecido" }));
        await terminar(stub, "cancelada", { tarefaId: msg.tarefaId });
        return;
      }
      // Erro da tarefa. O log leva só a classe do erro: a mensagem pode citar nome de arquivo e trechos do lead.
      console.error("[tarefa] falhou", { ...base, tentativa: c.tentativa, erro: classeDoErro(erro) });
      const mensagem = mensagemDeErro(erro);
      try {
        const salva = await gravarMensagem(e, { conversaId: msg.conversaId, tipo: "atlas", texto: mensagem, meta: { erro: true }, idCliente: `erro:${msg.tarefaId}` });
        await stub.publicar("mensagem", salva, msg.tarefaId);
      } catch (x) {
        console.error("[tarefa] não gravei a mensagem de erro", { ...base, erro: x instanceof Error ? x.name : "desconhecido" });
      }
      await terminar(stub, "erro", { tarefaId: msg.tarefaId, restaurar: true, erro: mensagem });
    }
  } finally {
    if (timer !== undefined) clearInterval(timer);
    liberar();
  }
}
