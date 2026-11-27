/**
 * Limite de tarefas simultâneas por isolate. A fila (`max_concurrency`) limita as invocações do consumidor no total, mas várias
 * delas podem cair no mesmo isolate, que tem 128 MB de memória no total: cada turno carrega anexos e o texto das fontes.
 * Quem passa do limite espera aqui, ainda como `na_fila` no DO (o assessor pode cancelar), e vê a posição.
 *
 * A espera é por sondagem sobre estado simples, não por uma Promise que outra invocação resolve: o workerd amarra cada Promise ao
 * contexto de I/O da invocação que a criou e cancela como "hung" a invocação que espera por algo que só outra poderia resolver.
 */
export class Semaforo {
  private ativas = 0;
  /** Quem espera, na ordem de chegada. A vaga vai para o primeiro. */
  private readonly fila: object[] = [];

  constructor(private readonly maximo: number, private readonly intervaloMs = 100) {
    this.maximo = Math.max(1, maximo);
  }

  get esperando() { return this.fila.length; }
  get emUso() { return this.ativas; }

  /** Espera uma vaga. `aoMudarPosicao(n)` roda ao entrar na espera e sempre que a posição mudar (n = 1 é o próximo). Devolve a função que libera a vaga. */
  async adquirir(aoMudarPosicao: (n: number) => void = () => {}): Promise<() => void> {
    if (this.ativas < this.maximo && this.fila.length === 0) { this.ativas++; return this.liberador(); }
    const ticket = {};
    this.fila.push(ticket);
    let ultima = 0;
    try {
      for (;;) {
        const posicao = this.fila.indexOf(ticket) + 1;
        if (posicao === 1 && this.ativas < this.maximo) {
          this.fila.shift();
          this.ativas++;
          return this.liberador();
        }
        if (posicao !== ultima) { ultima = posicao; aoMudarPosicao(posicao); }
        await new Promise<void>((r) => setTimeout(r, this.intervaloMs));
      }
    } catch (e) {
      const i = this.fila.indexOf(ticket);
      if (i >= 0) this.fila.splice(i, 1);
      throw e;
    }
  }

  private liberador(): () => void {
    let usada = false;
    return () => { if (!usada) { usada = true; this.ativas--; } };
  }
}

const g = globalThis as unknown as { __atlasSemaforo?: Semaforo };

/** O semáforo do isolate, criado na primeira tarefa com o tamanho de `config.tarefasPorIsolate`. */
export const semaforoDoIsolate = (maximo: number): Semaforo => (g.__atlasSemaforo ??= new Semaforo(maximo));
