/**
 * O Durable Object `Conversa` com os tipos de resultado de volta.
 *
 * O stub gerado por `conversaDo()` (`DurableObjectStub<Conversa>`) tipa como `never` o retorno de todo método cujo resultado tem um campo
 * `unknown` (`caso`, `contexto`, `payload`), porque o `Rpc.Result` do workers-types só aceita tipos serializáveis conhecidos. Em tempo de
 * execução o RPC devolve o objeto normalmente; o `never` só desliga a checagem de tipos de quem usa o resultado. Esta interface repete as
 * assinaturas de `workers/conversa.ts` que as rotas e a purga usam, para o resultado voltar tipado. Mudou o DO? Atualize aqui.
 */
import type { ResultadoCancelar, ResultadoSalvar, ResultadoTerminar } from "../../workers/conversa";
import { conversaDo } from "../cf";
import type { EstadoConversa, Faixa, ResultadoIniciar, StatusFinal, TipoTarefa } from "../tarefas/tipos";

export interface ConversaRpc {
  estado(): Promise<EstadoConversa>;
  obterCaso(): Promise<{ caso: unknown | null; versao: number }>;
  salvarCaso(caso: unknown, opcoes?: { versao?: number; tarefaId?: string }): Promise<ResultadoSalvar>;
  iniciarTarefa(tipo: TipoTarefa, payload?: unknown): Promise<ResultadoIniciar>;
  terminarTarefa(status: StatusFinal, opcoes?: { tarefaId?: string; restaurar?: boolean; erro?: string }): Promise<ResultadoTerminar>;
  cancelar(): Promise<ResultadoCancelar>;
  cancelado(tarefaId?: string): Promise<boolean>;
  alertaVisto(faixa: number): Promise<Faixa[] | null>;
  /** `sse()` é síncrono no DO, mas por RPC chega como Promise. */
  sse(lastEventId?: string | null): Promise<Response>;
  purgar(): Promise<{ ok: true }>;
}

export const conversaRpc = (conversaId: string, e?: CloudflareEnv): ConversaRpc => conversaDo(conversaId, e) as unknown as ConversaRpc;
