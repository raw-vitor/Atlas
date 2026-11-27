import { afterEach, describe, expect, it, vi } from "vitest";
import { alertaPendente, descreverContexto, faixaDe, formatarTokens, nivelDe, pctDe, textoAlerta } from "@/components/chat/contexto";
import {
  aplicarEvento, criarGerenciadorEventos, interpretarEvento, type EventoServidor, type FonteEventos,
} from "@/components/chat/eventos";
import { conversaVazia, menorSeq, mesclar, paraMensagem, tituloProvisorio } from "@/components/chat/mensagens";
import type { ConversaUI, Mensagem, MensagemSalva, TarefaPublica } from "@/components/chat/types";
import { executarComLimite } from "@/components/chat/upload";
import { urlDeck } from "@/components/chat/api";

const tarefa = (p: Partial<TarefaPublica> = {}): TarefaPublica => ({ id: "t1", tipo: "turno", status: "rodando", iniciada: 1, ...p });
const salva = (p: Partial<MensagemSalva>): MensagemSalva => ({ id: "m1", seq: 1, criada: 1, tipo: "atlas", texto: "oi", ...p });
const base = (p: Partial<ConversaUI> = {}): ConversaUI => ({ ...conversaVazia("c1"), ...p });

describe("medidor: faixas e formatação", () => {
  it("pctDe arredonda para baixo e limita a 100", () => {
    expect(pctDe(76_000, 200_000)).toBe(38);
    expect(pctDe(119_999, 200_000)).toBe(59);
    expect(pctDe(500_000, 200_000)).toBe(100);
    expect(pctDe(10, 0)).toBe(0);
    expect(pctDe(-5, 100)).toBe(0);
  });
  it("faixaDe muda em 60, 85 e 95", () => {
    expect([0, 59, 60, 84, 85, 94, 95, 100].map(faixaDe)).toEqual([null, null, 60, 60, 85, 85, 95, 95]);
    expect([59, 60, 84, 85, 94, 95].map(nivelDe)).toEqual(["ok", "atencao", "atencao", "alerta", "alerta", "critico"]);
  });
  it("alerta aparece uma vez por faixa e não volta depois de visto", () => {
    expect(alertaPendente(50, [])).toBeNull();
    expect(alertaPendente(62, [])).toBe(60);
    expect(alertaPendente(62, [60])).toBeNull();
    expect(alertaPendente(87, [60])).toBe(85);
    expect(alertaPendente(87, [85])).toBeNull();
    expect(alertaPendente(96, [60, 85])).toBe(95);
    expect(alertaPendente(96, [95])).toBeNull();
    // pulou direto para 90% sem ver o de 60%: só o da faixa atual
    expect(alertaPendente(90, [])).toBe(85);
  });
  it("formata números em pt-BR", () => {
    expect(formatarTokens(850)).toBe("850");
    expect(formatarTokens(76_000)).toBe("76 mil");
    expect(formatarTokens(200_000)).toBe("200 mil");
    expect(formatarTokens(1_500)).toBe("1,5 mil");
    expect(formatarTokens(999_600)).toBe("1 milhão");
    expect(formatarTokens(1_000_000)).toBe("1 milhão");
    expect(formatarTokens(2_500_000)).toBe("2,5 milhões");
  });
  it("tooltip traz porcentagem, partes e a marca de estimado", () => {
    const l = descreverContexto(76_000, 200_000, true, { transcricao: 50_000, carteira: 10_000, historico: 0, outros: 16_000 });
    expect(l[0]).toBe("Contexto: 38% (76 mil de 200 mil tokens)");
    expect(l[1]).toBe("Transcrição 50 mil · Carteira 10 mil · Outros 16 mil");
    expect(l[2]).toMatch(/estimado/i);
    expect(descreverContexto(76_000, 200_000)).toHaveLength(1);
  });
  it("textos dos alertas", () => {
    expect(textoAlerta(60, 62)).toBe("A conversa está ficando longa (62%).");
    expect(textoAlerta(85, 87)).toBe("A conversa está ficando longa (87%). As respostas podem demorar mais.");
    expect(textoAlerta(95, 96)).toBe("Contexto quase cheio (96%). Para não perder detalhes, comece uma nova conversa.");
  });
});

describe("fila de upload", () => {
  it("nunca passa de 3 simultâneos e mantém a ordem dos resultados", async () => {
    let ativos = 0, maximo = 0;
    const r = await executarComLimite([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      ativos++; maximo = Math.max(maximo, ativos);
      await new Promise((ok) => setTimeout(ok, 5 + (n % 3) * 3));
      ativos--;
      return n * 10;
    });
    expect(maximo).toBe(3);
    expect(r.map((x) => (x.status === "fulfilled" ? x.value : null))).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });
  it("uma falha não interrompe as outras", async () => {
    const r = await executarComLimite(["a", "b", "c"], 2, async (x) => { if (x === "b") throw new Error("falhou"); return x; });
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
  it("lista vazia termina sem chamar nada", async () => {
    const fn = vi.fn();
    expect(await executarComLimite([], 3, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("mensagens: mapeamento e mescla", () => {
  it("paraMensagem converte as três formas", () => {
    expect(paraMensagem(salva({ tipo: "usuario", texto: "x", idCliente: "k", meta: { anexos: [{ chave: "a/b", nome: "c.pdf", tamanho: 3, tipo: "application/pdf" }] } })))
      .toMatchObject({ tipo: "usuario", idCliente: "k", anexos: [{ nome: "c.pdf", status: "ok", chave: "a/b" }] });
    expect(paraMensagem(salva({ meta: { erro: true } }))).toMatchObject({ tipo: "atlas", erro: true });
    expect(paraMensagem(salva({ tipo: "resultado", meta: { versao: 2, resultado: { arquivos: {}, avisos: [], pendencias: [], resumo: { lead: "A", total: 1, perfil: "p" }, tokens: { chamadas: 0, entrada: 0, saida: 0 } } } })))
      .toMatchObject({ tipo: "resultado", versao: 2 });
  });
  it("mesclar não duplica por id nem por idCliente e respeita a ordem de seq", () => {
    const otimista: Mensagem = { id: "tmp", idCliente: "k", tipo: "usuario", texto: "oi", anexos: [], envio: "enviando" };
    let l = mesclar([], [otimista]);
    l = mesclar(l, [paraMensagem(salva({ id: "u1", seq: 5, tipo: "usuario", texto: "oi", idCliente: "k" }))]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ id: "u1", seq: 5 });
    l = mesclar(l, [paraMensagem(salva({ id: "a1", seq: 6 })), paraMensagem(salva({ id: "a1", seq: 6, texto: "novo" }))]);
    expect(l.map((m) => m.id)).toEqual(["u1", "a1"]);
    // páginas anteriores entram antes, em ordem
    l = mesclar(l, [paraMensagem(salva({ id: "x3", seq: 3 })), paraMensagem(salva({ id: "x2", seq: 2 }))]);
    expect(l.map((m) => m.id)).toEqual(["x2", "x3", "u1", "a1"]);
    expect(menorSeq(l)).toBe(2);
  });
  it("título provisório: 60 caracteres do texto ou o nome do primeiro anexo", () => {
    expect(tituloProvisorio("  R2   do\nElisandro ", [])).toBe("R2 do Elisandro");
    expect(tituloProvisorio("x".repeat(100), [])).toHaveLength(60);
    expect(tituloProvisorio("", ["carteira.xlsx"])).toBe("carteira.xlsx");
    expect(tituloProvisorio("", [])).toBeNull();
  });
  it("urlDeck prefere o link do servidor e monta o padrão sem ele", () => {
    expect(urlDeck("c1", 2, "pptx", "/api/conversas/c1/decks/2?fmt=pptx")).toBe("/api/conversas/c1/decks/2?fmt=pptx");
    expect(urlDeck("c1", 2, "pdf", "arquivo.pdf")).toBe("/api/conversas/c1/decks/2?fmt=pdf");
    expect(urlDeck("c1", undefined, "pdf", "arquivo.pdf")).toBeNull();
  });
});

describe("eventos do servidor → estado da tela", () => {
  it("interpretarEvento ignora nome desconhecido e JSON inválido", () => {
    expect(interpretarEvento("fim", '{"status":"concluida"}')).toEqual({ nome: "fim", dados: { status: "concluida" } });
    expect(interpretarEvento("outro", "{}")).toBeNull();
    expect(interpretarEvento("fim", "{quebrado")).toBeNull();
    expect(interpretarEvento("fim", "42")).toBeNull();
  });
  it("estado, fila, atividade e progresso", () => {
    let c = aplicarEvento(base(), { nome: "estado", dados: { tarefa: tarefa({ status: "na_fila", posicao: 3 }) } });
    expect(c.fila).toBe(3);
    c = aplicarEvento(c, { nome: "fila", dados: { posicao: 2 } });
    expect(c.fila).toBe(2);
    c = aplicarEvento(c, { nome: "atividade", dados: { texto: "Lendo a carteira" } });
    expect(c).toMatchObject({ fila: null, atividade: "Lendo a carteira", progresso: null });
    c = aplicarEvento(c, { nome: "progresso", dados: { etapa: "x", pct: 40, msg: "Montando slides" } });
    expect(c.progresso).toEqual({ pct: 40, msg: "Montando slides" });
    c = aplicarEvento(c, { nome: "estado", dados: { tarefa: null } });
    expect(c).toMatchObject({ tarefa: null, atividade: null, progresso: null, fila: null });
  });
  it("mensagem repetida (reconexão) não duplica e limpa o texto parcial", () => {
    const ev: EventoServidor = { nome: "mensagem", dados: salva({ id: "a1", seq: 9, texto: "pronto" }) };
    let c = aplicarEvento(base({ parcial: "pron" }), ev);
    c = aplicarEvento(c, ev);
    c = aplicarEvento(c, ev);
    expect(c.mensagens).toHaveLength(1);
    expect(c.parcial).toBeNull();
  });
  it("caso e contexto entram no estado", () => {
    const ctx = { tokens: 10, limite: 100, pct: 10, estimado: false, partes: { transcricao: 1, carteira: 1, historico: 1, outros: 1 } };
    expect(aplicarEvento(base(), { nome: "contexto", dados: ctx }).contexto).toEqual(ctx);
  });
  it("fim cancelada remove a mensagem do turno e mostra o aviso uma única vez", () => {
    const usuario: Mensagem = { id: "u1", tipo: "usuario", texto: "oi", anexos: [], seq: 1 };
    const antes = base({ mensagens: [usuario], tarefa: tarefa(), turnoMsgId: "u1" });
    const fim: EventoServidor = { nome: "fim", dados: { status: "cancelada" } };
    let c = aplicarEvento(antes, fim);
    expect(c.mensagens.map((m) => m.id)).toEqual(["local-cancelado-t1"]);
    expect(c.mensagens[0]).toMatchObject({ tipo: "atlas", texto: "Cancelado. Nada foi alterado na conversa." });
    expect(c.tarefa?.status).toBe("cancelada");
    c = aplicarEvento(c, fim); // repetido: nada muda
    expect(c.mensagens).toHaveLength(1);
  });
  it("fim cancelada sem o id do turno (página recarregada) remove a última mensagem do assessor", () => {
    const l: Mensagem[] = [
      { id: "a0", tipo: "atlas", texto: "antes", seq: 1 },
      { id: "u1", tipo: "usuario", texto: "oi", anexos: [], seq: 2 },
    ];
    const c = aplicarEvento(base({ mensagens: l, tarefa: tarefa({ status: "na_fila" }) }), { nome: "fim", dados: { status: "cancelada" } });
    expect(c.mensagens.map((m) => m.id)).toEqual(["a0", "local-cancelado-t1"]);
  });
  it("fim cancelada de deck só avisa, sem remover mensagem", () => {
    const u: Mensagem = { id: "u1", tipo: "usuario", texto: "oi", anexos: [], seq: 2 };
    const c = aplicarEvento(base({ mensagens: [u], tarefa: tarefa({ tipo: "deck" }) }), { nome: "fim", dados: { status: "cancelada" } });
    expect(c.mensagens.map((m) => m.id)).toEqual(["u1", "local-cancelado-t1"]);
    expect(c.mensagens[1]).toMatchObject({ texto: "Geração dos slides cancelada." });
  });
  it("fim concluída encerra a tarefa e zera o andamento", () => {
    const c = aplicarEvento(base({ tarefa: tarefa(), atividade: "x", parcial: "y", turnoMsgId: "u" }), { nome: "fim", dados: { status: "concluida" } });
    expect(c).toMatchObject({ atividade: null, parcial: null, turnoMsgId: null });
    expect(c.tarefa?.status).toBe("concluida");
  });
  it("erro vira aviso local sem duplicar, e some quando chega a mensagem gravada com erro", () => {
    let c = aplicarEvento(base(), { nome: "erro", dados: { mensagem: "Falhou" } });
    c = aplicarEvento(c, { nome: "erro", dados: { mensagem: "Falhou" } });
    expect(c.mensagens).toHaveLength(1);
    expect(c.mensagens[0]).toMatchObject({ tipo: "atlas", erro: true, texto: "Falhou" });
    c = aplicarEvento(c, { nome: "mensagem", dados: salva({ id: "e1", seq: 4, texto: "Falhou", meta: { erro: true } }) });
    expect(c.mensagens.map((m) => m.id)).toEqual(["e1"]);
  });
});

class FonteFalsa implements FonteEventos {
  static todas: FonteFalsa[] = [];
  readyState = 0; fechada = false;
  onopen: ((ev: Event) => void) | null = null; onerror: ((ev: Event) => void) | null = null;
  ouvintes = new Map<string, (ev: MessageEvent) => void>();
  constructor(public url: string) { FonteFalsa.todas.push(this); }
  addEventListener(nome: string, fn: (ev: MessageEvent) => void) { this.ouvintes.set(nome, fn); }
  close() { this.fechada = true; this.readyState = 2; }
  emitir(nome: string, dados: unknown) { this.ouvintes.get(nome)?.({ data: JSON.stringify(dados) } as MessageEvent); }
}

describe("conexão SSE", () => {
  afterEach(() => { FonteFalsa.todas = []; vi.useRealTimers(); });

  it("mantém uma conexão só: abrir outra conversa fecha a anterior", () => {
    const g = criarGerenciadorEventos((u) => new FonteFalsa(u));
    const recebidos: string[] = [];
    g.abrir("a", (e) => recebidos.push(`a:${e.nome}`));
    g.abrir("a", () => {}); // mesma conversa: não abre outra
    expect(FonteFalsa.todas).toHaveLength(1);
    g.abrir("b", (e) => recebidos.push(`b:${e.nome}`));
    expect(FonteFalsa.todas.map((f) => f.fechada)).toEqual([true, false]);
    expect(FonteFalsa.todas[1].url).toBe("/api/conversas/b/eventos");
    FonteFalsa.todas[0].emitir("texto", { texto: "atrasado" }); // evento da conexão antiga é ignorado
    FonteFalsa.todas[1].emitir("texto", { texto: "ok" });
    expect(recebidos).toEqual(["b:texto"]);
    g.fechar();
    expect(FonteFalsa.todas[1].fechada).toBe(true);
    expect(g.ativa()).toBeNull();
  });

  it("repassa só eventos válidos e informa a conexão", () => {
    const g = criarGerenciadorEventos((u) => new FonteFalsa(u));
    const e: string[] = [], estados: string[] = [];
    g.abrir("a", (x) => e.push(x.nome), (s) => estados.push(s));
    const f = FonteFalsa.todas[0];
    f.onopen?.(new Event("open"));
    f.ouvintes.get("fim")?.({ data: "{quebrado" } as MessageEvent);
    f.emitir("fim", { status: "concluida" });
    f.readyState = 0; f.onerror?.(new Event("error")); // o navegador reconecta sozinho
    expect(e).toEqual(["fim"]);
    expect(estados).toEqual(["ok", "reconectando"]);
    expect(f.fechada).toBe(false);
  });

  it("se o navegador desistir, reabre a mesma conversa depois de uma espera", () => {
    vi.useFakeTimers();
    const g = criarGerenciadorEventos((u) => new FonteFalsa(u));
    const estados: string[] = [];
    g.abrir("a", () => {}, (s) => estados.push(s));
    const f = FonteFalsa.todas[0];
    f.readyState = 2; f.onerror?.(new Event("error"));
    expect(FonteFalsa.todas).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(FonteFalsa.todas).toHaveLength(2);
    expect(FonteFalsa.todas[1].url).toBe(f.url);
    g.fechar(); // cancela reaberturas pendentes
    FonteFalsa.todas[1].readyState = 2; FonteFalsa.todas[1].onerror?.(new Event("error"));
    vi.advanceTimersByTime(60_000);
    expect(FonteFalsa.todas).toHaveLength(2);
  });
});
