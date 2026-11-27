/**
 * Durable Object `Conversa`: uma instância por conversa (`idFromName(conversaId)`).
 * Guarda no SQLite do DO o que o D1 não deve guardar: o caso, a tarefa em andamento (a trava), os eventos de progresso para
 * reconexão do SSE e os alertas do medidor já vistos. Mensagens e lista lateral ficam em D1; arquivos, em R2.
 *
 * Regras que as rotas e o consumidor da fila podem assumir:
 * - Um DO executa um método por vez e as operações em `ctx.storage.sql` são síncronas. Por isso "há tarefa ativa?" seguido de
 *   "criar tarefa" (iniciarTarefa) não tem corrida: dois pedidos simultâneos resultam em um `ok` e um `ocupado`.
 * - Só existe uma tarefa ativa (`na_fila` ou `rodando`). Se o consumidor morrer sem encerrá-la, ela expira em `LEASE_MS` sem
 *   batimento e a conversa destrava sozinha (o caso volta ao instantâneo tirado em `iniciarTarefa`).
 * - A fila entrega "pelo menos uma vez": `comecarTarefa(id, tentativa)` descarta duplicatas e entregas de tarefas já encerradas.
 * - Depois de `purgar()` a conversa fica marcada como purgada (uma linha sem dado do lead) e recusa qualquer escrita; assim um
 *   consumidor atrasado não recria o que foi apagado.
 */
import { DurableObject } from "cloudflare:workers";
import {
  CHUNK_CASO,
  LEASE_MS,
  MAX_EVENTOS,
  PING_MS,
  formatarSse,
  partirTexto,
} from "../lib/tarefas/limites";
import {
  FAIXAS,
  type EstadoConversa,
  type Faixa,
  type ResultadoComecar,
  type ResultadoIniciar,
  type StatusFinal,
  type StatusTarefa,
  type TarefaPublica,
  type TipoTarefa,
} from "../lib/tarefas/tipos";

interface LinhaTarefa extends Record<string, SqlStorageValue> {
  id: string;
  tipo: string;
  status: string;
  payload: string | null;
  iniciada: number;
  atualizada: number;
  terminada: number | null;
  tentativa: number;
  cancelar: number;
  tem_snapshot: number;
}

interface LinhaEvento extends Record<string, SqlStorageValue> {
  id: number;
  evento: string;
  dados: string;
}

export interface EventoGuardado {
  id: number;
  evento: string;
  dados: unknown;
}

export type ResultadoSalvar =
  | { ok: true; versao: number }
  | { ok: false; motivo: "versao" | "tarefa" | "purgada"; versao: number };

export type ResultadoTerminar =
  | { ok: true; tarefa: TarefaPublica; jaEncerrada: boolean }
  | { ok: false; motivo: "inexistente" | "purgada" };

export interface ResultadoCancelar {
  ok: true;
  /** A tarefa estava na fila e foi encerrada na hora (o consumidor, ao receber a mensagem, a descarta). */
  cancelada: boolean;
  /** A tarefa já rodava: a marca foi gravada e o consumidor a vê em `batimento`/`cancelado`. */
  cancelando: boolean;
  tarefa: TarefaPublica | null;
}

interface Assinante {
  enviar(texto: string): void;
  fechar(): void;
}

const ATIVOS = "('na_fila','rodando')";

function publica(l: LinhaTarefa): TarefaPublica {
  return { id: l.id, tipo: l.tipo as TipoTarefa, status: l.status as StatusTarefa, iniciada: l.iniciada };
}

const ehAtiva = (l: Pick<LinhaTarefa, "status">) => l.status === "na_fila" || l.status === "rodando";

export class Conversa extends DurableObject<CloudflareEnv> {
  private readonly sql: SqlStorage;
  private readonly assinantes = new Set<Assinante>();

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Evolução do esquema: acrescentar CREATE TABLE/ALTER aqui, guardado por `meta.schema`.
    ctx.blockConcurrencyWhile(async () => this.criarTabelas());
  }

  private criarTabelas() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL) WITHOUT ROWID;
      -- O caso serializado em JSON, em pedaços (ver CHUNK_CASO). slot "atual" é o vigente; "antes" é o instantâneo da tarefa ativa.
      CREATE TABLE IF NOT EXISTS caso (
        slot TEXT NOT NULL, parte INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (slot, parte)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS tarefa (
        id TEXT PRIMARY KEY,
        tipo TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT,
        iniciada INTEGER NOT NULL,
        atualizada INTEGER NOT NULL,   -- último batimento (lease)
        terminada INTEGER,
        tentativa INTEGER NOT NULL DEFAULT 0,
        cancelar INTEGER NOT NULL DEFAULT 0,
        tem_snapshot INTEGER NOT NULL DEFAULT 0
      );
      -- No máximo uma tarefa ativa, garantido também pelo banco.
      CREATE UNIQUE INDEX IF NOT EXISTS tarefa_unica_ativa ON tarefa((1)) WHERE status IN ${ATIVOS};
      CREATE TABLE IF NOT EXISTS eventos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,   -- crescente por conversa, nunca reutilizado: é o Last-Event-ID do SSE
        tarefa_id TEXT,
        evento TEXT NOT NULL,
        dados TEXT NOT NULL,
        criado INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alertas (faixa INTEGER PRIMARY KEY, visto INTEGER NOT NULL);
    `);
  }

  // ---------------------------------------------------------------- meta

  private meta(chave: string): string | null {
    const r = this.sql.exec<{ valor: string }>("SELECT valor FROM meta WHERE chave = ?", chave).toArray();
    return r.length ? r[0].valor : null;
  }

  private gravarMeta(chave: string, valor: string) {
    this.sql.exec("INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor", chave, valor);
  }

  private get purgada(): boolean {
    return this.meta("purgada") !== null;
  }

  // ---------------------------------------------------------------- caso

  /** O caso vigente (JSON já desserializado) e a versão. `caso` é null numa conversa recém-criada. */
  async obterCaso(): Promise<{ caso: unknown | null; versao: number }> {
    const versao = Number(this.meta("caso_versao") ?? 0);
    if (this.purgada) return { caso: null, versao };
    return { caso: this.lerCaso("atual"), versao };
  }

  private lerCaso(slot: "atual" | "antes"): unknown | null {
    const partes = this.sql.exec<{ json: string }>("SELECT json FROM caso WHERE slot = ? ORDER BY parte", slot).toArray();
    return partes.length ? JSON.parse(partes.map((p) => p.json).join("")) : null;
  }

  /**
   * Grava o caso (sem o texto das fontes, que fica em R2). Troca atômica: ou o caso novo inteiro, ou o anterior.
   * - `versao`: se informada, só grava quando é a versão vigente (controle otimista).
   * - `tarefaId`: se informada, só grava enquanto essa tarefa estiver ativa (um consumidor atrasado ou duplicado é recusado).
   */
  async salvarCaso(caso: unknown, opcoes: { versao?: number; tarefaId?: string } = {}): Promise<ResultadoSalvar> {
    const atual = Number(this.meta("caso_versao") ?? 0);
    if (this.purgada) return { ok: false, motivo: "purgada", versao: atual };
    if (opcoes.tarefaId !== undefined) {
      const t = this.linhaTarefa(opcoes.tarefaId);
      if (!t || !ehAtiva(t)) return { ok: false, motivo: "tarefa", versao: atual };
    }
    if (opcoes.versao !== undefined && opcoes.versao !== atual) return { ok: false, motivo: "versao", versao: atual };
    const json = JSON.stringify(caso);
    if (json === undefined) throw new Error("O caso não é serializável em JSON");
    const partes = partirTexto(json, CHUNK_CASO);
    const nova = atual + 1;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM caso WHERE slot = 'atual'");
      partes.forEach((p, i) => this.sql.exec("INSERT INTO caso (slot, parte, json) VALUES ('atual', ?, ?)", i, p));
      this.gravarMeta("caso_versao", String(nova));
    });
    return { ok: true, versao: nova };
  }

  // ---------------------------------------------------------------- tarefa (a trava)

  private linhaTarefa(id: string): LinhaTarefa | null {
    const r = this.sql.exec<LinhaTarefa>("SELECT * FROM tarefa WHERE id = ?", id).toArray();
    return r.length ? r[0] : null;
  }

  /** A tarefa ativa. Se estiver sem batimento além do lease, é encerrada como erro (e o caso volta ao instantâneo) antes de responder. */
  private tarefaAtiva(): LinhaTarefa | null {
    const r = this.sql.exec<LinhaTarefa>(`SELECT * FROM tarefa WHERE status IN ${ATIVOS} LIMIT 1`).toArray();
    if (!r.length) return null;
    const t = r[0];
    if (Date.now() - t.atualizada > LEASE_MS) {
      this.encerrar(t, "erro", { restaurar: true, erro: "A tarefa parou de responder e foi encerrada." });
      return null;
    }
    return t;
  }

  /**
   * Pega a trava da conversa e cria a tarefa (`na_fila`). Quem chama enfileira a mensagem em `atlas-tarefas` só se `ok`.
   * `payload` (JSON) fica no DO e é devolvido por `comecarTarefa`: assim o conteúdo do lead não viaja na fila.
   * Tira o instantâneo do caso (restaurado se a tarefa for cancelada ou expirar) e descarta tarefas e eventos mais antigos
   * que a última tarefa encerrada.
   */
  async iniciarTarefa(tipo: TipoTarefa, payload?: unknown): Promise<ResultadoIniciar> {
    if (this.purgada) return { ok: false, purgada: true };
    const ativa = this.tarefaAtiva();
    if (ativa) return { ok: false, ocupado: true, tarefa: publica(ativa) };
    const id = crypto.randomUUID().replaceAll("-", "");
    const agora = Date.now();
    const serial = payload === undefined ? null : JSON.stringify(payload);
    this.ctx.storage.transactionSync(() => {
      const ultima = this.sql.exec<{ id: string }>("SELECT id FROM tarefa ORDER BY iniciada DESC, rowid DESC LIMIT 1").toArray();
      const manter = ultima.length ? ultima[0].id : "";
      this.sql.exec("DELETE FROM eventos WHERE tarefa_id IS NULL OR tarefa_id <> ?", manter);
      this.sql.exec("DELETE FROM tarefa WHERE id <> ?", manter);
      this.sql.exec("DELETE FROM caso WHERE slot = 'antes'");
      this.sql.exec("INSERT INTO caso (slot, parte, json) SELECT 'antes', parte, json FROM caso WHERE slot = 'atual'");
      this.sql.exec(
        "INSERT INTO tarefa (id, tipo, status, payload, iniciada, atualizada, tem_snapshot) VALUES (?, ?, 'na_fila', ?, ?, ?, 1)",
        id, tipo, serial, agora, agora,
      );
    });
    const tarefa = publica(this.linhaTarefa(id)!);
    this.transmitir(formatarSse("estado", { tarefa }));
    return { ok: true, tarefa };
  }

  /**
   * Chamado pelo consumidor da fila ao receber a mensagem. `tentativa` é `message.attempts`.
   * - na fila: passa a rodando;
   * - rodando com tentativa maior: a entrega anterior falhou e a fila reentregou, então continua;
   * - rodando com a mesma tentativa ou menor: entrega duplicada, o consumidor deve só dar ack;
   * - encerrada (cancelada na fila, expirada, já concluída): o consumidor deve só dar ack.
   */
  async comecarTarefa(id: string, tentativa = 1): Promise<ResultadoComecar> {
    if (this.purgada) return { ok: false, motivo: "purgada", tarefa: null };
    this.tarefaAtiva(); // aplica a expiração do lease, se for o caso
    const t = this.linhaTarefa(id);
    if (!t) return { ok: false, motivo: "inexistente", tarefa: null };
    if (!ehAtiva(t)) return { ok: false, motivo: "encerrada", tarefa: publica(t) };
    if (t.status === "rodando" && tentativa <= t.tentativa) return { ok: false, motivo: "em_execucao", tarefa: publica(t) };
    if (t.cancelar) {
      const e = this.encerrar(t, "cancelada", { restaurar: true });
      return { ok: false, motivo: "encerrada", tarefa: e };
    }
    this.sql.exec("UPDATE tarefa SET status = 'rodando', tentativa = ?, atualizada = ? WHERE id = ?", tentativa, Date.now(), id);
    const novo = this.linhaTarefa(id)!;
    return { ok: true, tarefa: publica(novo), payload: novo.payload === null ? null : JSON.parse(novo.payload) };
  }

  /**
   * Batimento do consumidor: renova o lease e informa se o assessor cancelou. Chamar a cada poucos segundos durante a tarefa
   * (e abortar o `fetch` em andamento quando `cancelada`). `ativa: false` significa que a tarefa já foi encerrada por outro
   * caminho (cancelada na fila, expirada ou purga): o consumidor deve parar sem gravar nada.
   */
  async batimento(tarefaId: string): Promise<{ ativa: boolean; cancelada: boolean }> {
    if (this.purgada) return { ativa: false, cancelada: true };
    const t = this.linhaTarefa(tarefaId);
    if (!t || !ehAtiva(t)) return { ativa: false, cancelada: t?.status === "cancelada" };
    this.sql.exec("UPDATE tarefa SET atualizada = ? WHERE id = ?", Date.now(), tarefaId);
    return { ativa: true, cancelada: t.cancelar === 1 };
  }

  /** O assessor pediu cancelamento da tarefa ativa (ou da `tarefaId`)? Consultado entre as chamadas ao LLM (`checarCancelado`). */
  async cancelado(tarefaId?: string): Promise<boolean> {
    const t = tarefaId === undefined ? this.tarefaAtiva() : this.linhaTarefa(tarefaId);
    if (!t) return false;
    return t.cancelar === 1 || t.status === "cancelada";
  }

  /**
   * Cancelamento pedido pelo assessor. Idempotente. Na fila: encerra na hora e restaura o caso. Rodando: grava a marca e o
   * consumidor encerra com `terminarTarefa("cancelada")`.
   */
  async cancelar(): Promise<ResultadoCancelar> {
    if (this.purgada) return { ok: true, cancelada: false, cancelando: false, tarefa: null };
    const t = this.tarefaAtiva();
    if (!t) return { ok: true, cancelada: false, cancelando: false, tarefa: null };
    if (t.status === "na_fila") {
      const e = this.encerrar(t, "cancelada", { restaurar: true });
      return { ok: true, cancelada: true, cancelando: false, tarefa: e };
    }
    this.sql.exec("UPDATE tarefa SET cancelar = 1 WHERE id = ?", t.id);
    return { ok: true, cancelada: false, cancelando: true, tarefa: publica(t) };
  }

  /**
   * Encerra a tarefa e publica `fim` na mesma operação: quem reconecta vê `fim` se e somente se a tarefa terminou. Idempotente.
   * `restaurar` devolve o caso ao instantâneo tirado em `iniciarTarefa` (padrão: só quando `cancelada`).
   */
  async terminarTarefa(
    status: StatusFinal,
    opcoes: { tarefaId?: string; restaurar?: boolean; erro?: string } = {},
  ): Promise<ResultadoTerminar> {
    if (this.purgada) return { ok: false, motivo: "purgada" };
    const t = opcoes.tarefaId === undefined ? this.tarefaAtiva() : this.linhaTarefa(opcoes.tarefaId);
    if (!t) return { ok: false, motivo: "inexistente" };
    if (!ehAtiva(t)) return { ok: true, tarefa: publica(t), jaEncerrada: true };
    const tarefa = this.encerrar(t, status, { restaurar: opcoes.restaurar ?? status === "cancelada", erro: opcoes.erro });
    return { ok: true, tarefa, jaEncerrada: false };
  }

  private encerrar(t: LinhaTarefa, status: StatusFinal, o: { restaurar: boolean; erro?: string }): TarefaPublica {
    const gravados: EventoGuardado[] = [];
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE tarefa SET status = ?, terminada = ?, atualizada = ? WHERE id = ?", status, Date.now(), Date.now(), t.id);
      if (o.restaurar && t.tem_snapshot) this.restaurarSnapshot();
      if (o.erro) gravados.push(this.gravarEvento("erro", { mensagem: o.erro }, t.id));
      gravados.push(this.gravarEvento("fim", { status }, t.id));
    });
    for (const e of gravados) this.transmitir(formatarSse(e.evento, e.dados, e.id));
    return publica(this.linhaTarefa(t.id)!);
  }

  private restaurarSnapshot() {
    const antes = this.sql.exec("SELECT 1 FROM caso WHERE slot = 'antes' LIMIT 1").toArray();
    this.sql.exec("DELETE FROM caso WHERE slot = 'atual'");
    if (antes.length) this.sql.exec("INSERT INTO caso (slot, parte, json) SELECT 'atual', parte, json FROM caso WHERE slot = 'antes'");
    this.gravarMeta("caso_versao", String(Number(this.meta("caso_versao") ?? 0) + 1));
  }

  // ---------------------------------------------------------------- eventos e SSE

  private gravarEvento(evento: string, dados: unknown, tarefaId: string | null): EventoGuardado {
    const serial = JSON.stringify(dados ?? null);
    const r = this.sql
      .exec<{ id: number }>("INSERT INTO eventos (tarefa_id, evento, dados, criado) VALUES (?, ?, ?, ?) RETURNING id", tarefaId, evento, serial, Date.now())
      .one();
    this.sql.exec("DELETE FROM eventos WHERE id <= ?", r.id - MAX_EVENTOS);
    if (evento === "contexto") this.gravarMeta("contexto", serial);
    return { id: r.id, evento, dados: dados ?? null };
  }

  /**
   * Grava o evento (para reconexão) e o entrega a quem está conectado. Devolve o id do evento, ou null se foi ignorado
   * (conversa purgada, ou `tarefaId` informada de tarefa que não está mais ativa).
   */
  async publicar(evento: string, dados: unknown, tarefaId?: string): Promise<number | null> {
    if (this.purgada) return null;
    if (tarefaId !== undefined) {
      const t = this.linhaTarefa(tarefaId);
      if (!t || !ehAtiva(t)) return null;
      this.sql.exec("UPDATE tarefa SET atualizada = ? WHERE id = ?", Date.now(), tarefaId);
    }
    const dono = tarefaId ?? this.tarefaAtiva()?.id ?? null;
    const e = this.gravarEvento(evento, dados, dono);
    this.transmitir(formatarSse(e.evento, e.dados, e.id));
    return e.id;
  }

  /** Eventos guardados com id maior que `id`, em ordem. */
  async eventosDesde(id: number, limite = 500): Promise<EventoGuardado[]> {
    if (this.purgada) return [];
    return this.lerEventos(id, limite);
  }

  private lerEventos(id: number, limite: number): EventoGuardado[] {
    return this.sql
      .exec<LinhaEvento>("SELECT id, evento, dados FROM eventos WHERE id > ? ORDER BY id LIMIT ?", id, limite)
      .toArray()
      .map((l) => ({ id: l.id, evento: l.evento, dados: JSON.parse(l.dados) }));
  }

  private transmitir(texto: string) {
    for (const a of [...this.assinantes]) a.enviar(texto);
  }

  /**
   * Resposta `text/event-stream` com o progresso da conversa.
   * - O primeiro evento é sempre `estado` (sem id, para não alterar o Last-Event-ID do navegador).
   * - Com `lastEventId`: reenvia os eventos guardados com id maior (cobre a tarefa atual e a última encerrada).
   * - Sem `lastEventId`: se há tarefa ativa, reenvia os eventos dela desde o início; sem tarefa, só `estado`.
   * - Depois fica aberta, entregando novos eventos e `: ping` a cada PING_MS.
   * A reprodução e a assinatura acontecem no mesmo trecho síncrono: nenhum evento se perde entre as duas.
   */
  sse(lastEventId?: number | string | null): Response {
    const codificar = new TextEncoder();
    const desde = lastEventId === undefined || lastEventId === null || lastEventId === "" ? null : Number(lastEventId);
    let assinante: Assinante | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const limpar = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (assinante) this.assinantes.delete(assinante);
      assinante = undefined;
    };
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const enviar = (texto: string) => {
          try {
            controller.enqueue(codificar.encode(texto));
          } catch {
            limpar(); // o cliente já saiu
          }
        };
        if (this.purgada) {
          enviar(formatarSse("estado", { tarefa: null }));
          controller.close();
          return;
        }
        const ativa = this.tarefaAtiva();
        enviar("retry: 3000\n\n");
        enviar(formatarSse("estado", { tarefa: ativa ? publica(ativa) : null }));
        let reenviar: EventoGuardado[] = [];
        if (desde !== null && Number.isFinite(desde)) reenviar = this.lerEventos(desde, MAX_EVENTOS);
        else if (ativa) reenviar = this.sql
          .exec<LinhaEvento>("SELECT id, evento, dados FROM eventos WHERE tarefa_id = ? ORDER BY id", ativa.id)
          .toArray()
          .map((l) => ({ id: l.id, evento: l.evento, dados: JSON.parse(l.dados) }));
        for (const e of reenviar) enviar(formatarSse(e.evento, e.dados, e.id));
        assinante = {
          enviar,
          fechar: () => {
            limpar();
            try { controller.close(); } catch { /* já fechado */ }
          },
        };
        this.assinantes.add(assinante);
        timer = setInterval(() => enviar(": ping\n\n"), PING_MS);
      },
      cancel: () => limpar(),
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  }

  // ---------------------------------------------------------------- alertas do medidor

  /** Marca a faixa como vista (uma vez por conversa). Devolve todas as faixas vistas, ou null se a faixa for inválida. */
  async alertaVisto(faixa: number): Promise<Faixa[] | null> {
    if (this.purgada || !FAIXAS.includes(faixa as Faixa)) return null;
    this.sql.exec("INSERT OR IGNORE INTO alertas (faixa, visto) VALUES (?, ?)", faixa, Date.now());
    return this.faixasVistas();
  }

  private faixasVistas(): Faixa[] {
    return this.sql.exec<{ faixa: number }>("SELECT faixa FROM alertas ORDER BY faixa").toArray().map((r) => r.faixa as Faixa);
  }

  // ---------------------------------------------------------------- estado e purga

  /** Tudo o que `GET /api/conversas/{id}` precisa do DO, numa chamada. */
  async estado(): Promise<EstadoConversa> {
    if (this.purgada) return { tarefa: null, contexto: null, alertasVistos: [], purgada: true };
    const t = this.tarefaAtiva() ?? this.ultimaTarefa();
    const ctx = this.meta("contexto");
    return { tarefa: t ? publica(t) : null, contexto: ctx === null ? null : JSON.parse(ctx), alertasVistos: this.faixasVistas(), purgada: false };
  }

  private ultimaTarefa(): LinhaTarefa | null {
    const r = this.sql.exec<LinhaTarefa>("SELECT * FROM tarefa ORDER BY iniciada DESC, rowid DESC LIMIT 1").toArray();
    return r.length ? r[0] : null;
  }

  /**
   * Apaga tudo o que a conversa guardou aqui (caso, tarefas, eventos, alertas) e fecha os SSE abertos. Idempotente.
   * Fica só a marca `purgada` (sem dado do lead), que faz o DO recusar escritas de consumidores atrasados.
   * Quem chama (consumidor `purga`) já apagou ou apagará R2 e D1; a ordem recomendada é R2, DO, D1.
   */
  async purgar(): Promise<{ ok: true }> {
    for (const a of [...this.assinantes]) a.fechar();
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.deleteAll();
      this.criarTabelas();
      this.gravarMeta("purgada", String(Date.now()));
    });
    return { ok: true };
  }
}
