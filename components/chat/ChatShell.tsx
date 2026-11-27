"use client";
import { Button, Flex, Heading, IconButton, Skeleton, Stack, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuMenu, LuSquare } from "react-icons/lu";
import { AtlasOrb } from "@/components/atlas/AtlasOrb";
import {
  ErroApi, apagarConversa, cancelarTarefa, criarConversa, ehCancelamento, enviarAnexo, enviarMensagem, gerarSlides,
  listarConversas, listarMensagens, marcarAlertaVisto, obterConversa, textoDoErro,
} from "./api";
import { Composer } from "./Composer";
import { ContextoAlerta } from "./ContextoAlerta";
import { ContextoMedidor } from "./ContextoMedidor";
import { ConversaLista, type EstadoLista } from "./ConversaLista";
import { pctDe } from "./contexto";
import {
  AVISO_CANCELADO, aplicarEvento, avisoLocal, criarGerenciadorEventos, type EstadoConexao, type EventoServidor,
} from "./eventos";
import { MessageList, type Pendente } from "./MessageList";
import { conversaVazia, estaOcupada, menorSeq, mesclar, paraMensagem, tarefaAtiva, tituloProvisorio, uid } from "./mensagens";
import { ProgressMessage } from "./ProgressMessage";
import type { AnexoUI, Faixa, Mensagem, ConversaResumo, ConversaUI } from "./types";
import { UPLOADS_SIMULTANEOS, executarComLimite } from "./upload";

/** Id da conversa que ainda não existe no servidor: ela só é criada no primeiro envio. */
const RASCUNHO = "novo";

const JANELA_ESTADO_ATRASADO_MS = 4000;

interface Envio { ac: AbortController; fase: "upload" | "post"; cancelar: boolean; fimVisto: boolean }
interface Pendencia { files: File[]; chaves: (string | undefined)[] }

const atualizarUrl = (id: string | null) => {
  if (typeof window !== "undefined") window.history.replaceState(null, "", id ? `?c=${id}` : window.location.pathname);
};

export function ChatShell({ conversaInicial }: { conversaInicial?: string }) {
  const [lista, setLista] = useState<ConversaResumo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [estadoLista, setEstadoLista] = useState<EstadoLista>("carregando");
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erroMais, setErroMais] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, ConversaUI>>(() => ({
    [RASCUNHO]: conversaVazia(RASCUNHO),
    ...(conversaInicial ? { [conversaInicial]: { ...conversaVazia(conversaInicial), carga: "carregando" as const } } : {}),
  }));
  const [ativaId, setAtivaId] = useState(conversaInicial ?? RASCUNHO);
  const [conexao, setConexao] = useState<{ id: string; estado: EstadoConexao }>({ id: "", estado: "ok" });
  const [menu, setMenu] = useState(true);
  const [texto, setTexto] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [foco, setFoco] = useState(0);
  const profundidade = useRef(0);

  // Espelhos em ref do que as funções assíncronas precisam ler no momento em que rodam.
  const ativaRef = useRef(ativaId);
  const cacheRef = useRef(cache);
  const listaRef = useRef(lista);
  useEffect(() => { ativaRef.current = ativaId; cacheRef.current = cache; listaRef.current = lista; });
  const envios = useRef(new Map<string, Envio>());
  const pendencias = useRef(new Map<string, Pendencia>());
  const apagando = useRef(new Set<string>());
  // Quando este navegador pediu uma tarefa (o `estado` do SSE pode chegar atrasado e dizer "sem tarefa").
  const aceitaEm = useRef(new Map<string, number>());
  const tratarRef = useRef<(cid: string, e: EventoServidor) => void>(() => {});
  const [eventos] = useState(() => criarGerenciadorEventos());

  const atualizar = useCallback((cid: string, fn: (c: ConversaUI) => ConversaUI) =>
    setCache((cs) => (cs[cid] ? { ...cs, [cid]: fn(cs[cid]) } : cs)), []);
  const atualizarItem = useCallback((id: string, parte: Partial<ConversaResumo>) =>
    setLista((l) => l.map((i) => (i.id === id ? { ...i, ...parte } : i))), []);

  // ---- Lista lateral ----

  const buscarLista = useCallback(async () => {
    try {
      const r = await listarConversas();
      setLista(r.itens); setCursor(r.cursor); setEstadoLista("ok");
    } catch { setEstadoLista("erro"); }
  }, []);

  const carregarMais = useCallback(async () => {
    if (!cursor) return;
    setCarregandoMais(true); setErroMais(false);
    try {
      const r = await listarConversas(cursor);
      setLista((l) => { const ids = new Set(l.map((i) => i.id)); return [...l, ...r.itens.filter((i) => !ids.has(i.id) && !apagando.current.has(i.id))]; });
      setCursor(r.cursor);
    } catch { setErroMais(true); }
    setCarregandoMais(false);
  }, [cursor]);

  /** Traz a primeira página de novo: reflete título, contexto e ordem depois de uma tarefa. */
  const atualizarCabeca = useCallback(async () => {
    try {
      const r = await listarConversas();
      const novos = r.itens.filter((i) => !apagando.current.has(i.id));
      const unicoPagina = listaRef.current.length <= r.itens.length;
      setLista((l) => { const ids = new Set(novos.map((i) => i.id)); return [...novos, ...l.filter((i) => !ids.has(i.id))]; });
      if (unicoPagina) setCursor(r.cursor);
    } catch { /* a lista só fica um pouco desatualizada */ }
  }, []);

  // ---- Abrir conversa ----

  /** Busca a conversa e as últimas mensagens e junta ao que já está na tela. */
  const carregarConversa = useCallback(async (id: string, inicial: boolean) => {
    try {
      const [d, m] = await Promise.all([obterConversa(id), listarMensagens(id)]);
      atualizar(id, (c) => {
        const base: ConversaUI = {
          ...c, titulo: d.conversa.titulo, caso: d.caso, contexto: d.contexto ?? c.contexto, alertasVistos: d.alertasVistos,
          mensagens: mesclar(c.mensagens, m.itens.map(paraMensagem)), carga: "ok", erroCarga: undefined,
          maisAntigas: inicial ? m.maisAntigas : c.maisAntigas,
        };
        return c.enviando ? base : aplicarEvento(base, { nome: "estado", dados: { tarefa: d.tarefa } });
      });
      atualizarItem(id, d.conversa);
    } catch (e) {
      if (!inicial) return;
      if (e instanceof ErroApi && e.status === 404) {
        setLista((l) => l.filter((i) => i.id !== id));
        setCache((cs) => { const n = { ...cs }; delete n[id]; return n; });
        if (ativaRef.current === id) { setAtivaId(RASCUNHO); atualizarUrl(null); }
      } else atualizar(id, (c) => ({ ...c, carga: "erro", erroCarga: textoDoErro(e) }));
    }
  }, [atualizar, atualizarItem]);

  const abrir = useCallback((id: string) => {
    if (id === ativaRef.current) return;
    setAtivaId(id); atualizarUrl(id === RASCUNHO ? null : id);
    if (id === RASCUNHO) return;
    const c = cacheRef.current[id];
    // Já aberta nesta sessão: aparece na hora e é revalidada em silêncio.
    if (c && c.carga === "ok") { void carregarConversa(id, false); return; }
    const titulo = listaRef.current.find((i) => i.id === id)?.titulo ?? "Nova conversa";
    setCache((cs) => ({ ...cs, [id]: { ...conversaVazia(id, titulo), carga: "carregando" } }));
    void carregarConversa(id, true);
  }, [carregarConversa]);

  const tentarConversa = useCallback((id: string) => {
    atualizar(id, (c) => ({ ...c, carga: "carregando", erroCarga: undefined }));
    void carregarConversa(id, true);
  }, [atualizar, carregarConversa]);

  const carregarAnteriores = useCallback(async () => {
    const cid = ativaRef.current;
    const antes = menorSeq(cacheRef.current[cid]?.mensagens ?? []);
    if (antes == null || cid === RASCUNHO) return;
    atualizar(cid, (c) => ({ ...c, anteriores: "carregando" }));
    try {
      const r = await listarMensagens(cid, { antes });
      atualizar(cid, (c) => ({ ...c, anteriores: "ocioso", maisAntigas: r.maisAntigas, mensagens: mesclar(c.mensagens, r.itens.map(paraMensagem)) }));
    } catch { atualizar(cid, (c) => ({ ...c, anteriores: "erro" })); }
  }, [atualizar]);

  useEffect(() => {
    void buscarLista();
    if (conversaInicial) void carregarConversa(conversaInicial, true);
  }, [buscarLista, carregarConversa, conversaInicial]);

  // ---- Eventos do servidor (uma conexão só: a da conversa ativa) ----

  useEffect(() => {
    tratarRef.current = (cid, e) => {
      const antes = cacheRef.current[cid];
      if (e.nome === "fim") { const env = envios.current.get(cid); if (env) env.fimVisto = true; }
      if (e.nome === "fim" && e.dados.status === "cancelada" && antes && tarefaAtiva(antes.tarefa) && antes.tarefa.tipo === "turno") {
        // O que o assessor tinha escrito volta para o campo, como antes de a conversa ser persistida.
        const msg = antes.mensagens.find((m) => m.id === antes.turnoMsgId);
        const devolver = msg?.tipo === "usuario" ? { texto: msg.texto, files: pendencias.current.get(msg.id)?.files ?? [] } : null;
        if (devolver && cid === ativaRef.current) { setTexto((t) => t || devolver.texto); setArquivos((a) => (a.length ? a : devolver.files)); }
      }
      if (e.nome === "estado" && e.dados.tarefa === null && Date.now() - (aceitaEm.current.get(cid) ?? 0) < JANELA_ESTADO_ATRASADO_MS) {
        // `estado` tirado antes de a tarefa existir: ignora e confere no servidor depois.
        setTimeout(() => void carregarConversa(cid, false), JANELA_ESTADO_ATRASADO_MS);
        return;
      }
      atualizar(cid, (c) => aplicarEvento(c, e));
      if (e.nome === "contexto") atualizarItem(cid, { ctxTokens: e.dados.tokens, ctxLimite: e.dados.limite });
      if (e.nome === "fim") void carregarConversa(cid, false).then(atualizarCabeca);
    };
  });

  useEffect(() => {
    if (ativaId === RASCUNHO) { eventos.fechar(); return; }
    const id = ativaId;
    eventos.abrir(id, (e) => tratarRef.current(id, e), (estado) => setConexao({ id, estado }));
  }, [ativaId, eventos]);
  useEffect(() => () => eventos.fechar(), [eventos]);

  // ---- Enviar ----

  const marcarMensagem = useCallback((cid: string, id: string, fn: (m: Extract<Mensagem, { tipo: "usuario" }>) => Mensagem) =>
    atualizar(cid, (c) => ({ ...c, mensagens: c.mensagens.map((m) => (m.id === id && m.tipo === "usuario" ? fn(m) : m)) })), [atualizar]);

  const processarEnvio = useCallback(async (cidInicial: string, idCliente: string, textoMsg: string) => {
    let cid = cidInicial;
    const envio: Envio = { ac: new AbortController(), fase: "upload", cancelar: false, fimVisto: false };
    envios.current.set(cid, envio);
    const pend = pendencias.current.get(idCliente) ?? { files: [], chaves: [] };
    const verificar = () => { if (envio.cancelar) throw new DOMException("Cancelado", "AbortError"); };
    const falhar = (erro: string) => atualizar(cid, (c) => ({ ...c, enviando: false,
      mensagens: c.mensagens.map((m) => (m.id === idCliente && m.tipo === "usuario" ? { ...m, envio: "falhou" as const, erro } : m)) }));
    try {
      if (cid === RASCUNHO) {
        const novo = await criarConversa();
        const real = novo.conversa.id;
        envios.current.delete(RASCUNHO); envios.current.set(real, envio);
        setCache((cs) => {
          const n = { ...cs, [real]: { ...cs[RASCUNHO], id: real, titulo: novo.conversa.titulo, caso: novo.caso }, [RASCUNHO]: conversaVazia(RASCUNHO) };
          return n;
        });
        setLista((l) => [novo.conversa, ...l.filter((i) => i.id !== real)]);
        cid = real;
        if (ativaRef.current === RASCUNHO) { setAtivaId(real); atualizarUrl(real); }
        verificar();
      }
      const faltam = pend.files.map((_, i) => i).filter((i) => !pend.chaves[i]);
      const marcar = (i: number, parte: Partial<AnexoUI>) =>
        marcarMensagem(cid, idCliente, (m) => ({ ...m, anexos: m.anexos.map((a, j) => (j === i ? { ...a, ...parte } : a)) }));
      const res = await executarComLimite(faltam, UPLOADS_SIMULTANEOS, async (i) => {
        marcar(i, { status: "subindo", pct: 0, erro: undefined });
        try {
          const a = await enviarAnexo(cid, pend.files[i], (pct) => marcar(i, { pct }), envio.ac.signal);
          pend.chaves[i] = a.chave;
          marcar(i, { status: "ok", pct: 100, chave: a.chave });
        } catch (e) {
          if (!ehCancelamento(e)) marcar(i, { status: "erro", erro: textoDoErro(e) });
          throw e;
        }
      });
      verificar();
      const erro = res.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (erro) return falhar(textoDoErro(erro.reason) + (res.filter((r) => r.status === "rejected").length > 1 ? " (e outros arquivos)" : ""));

      envio.fase = "post";
      const r = await enviarMensagem(cid, { texto: textoMsg, anexos: pend.chaves.filter((c): c is string => !!c), idCliente });
      pendencias.current.delete(idCliente);
      aceitaEm.current.set(cid, Date.now());
      const titulo = tituloProvisorio(textoMsg, pend.files.map((f) => f.name));
      atualizar(cid, (c) => {
        const base: ConversaUI = { ...c, enviando: false, turnoMsgId: r.mensagem.id, mensagens: mesclar(c.mensagens, [paraMensagem(r.mensagem)]),
          titulo: c.titulo === "Nova conversa" && titulo ? titulo : c.titulo };
        // Se o `fim` já chegou pelo SSE antes desta resposta, a tarefa não está mais ativa.
        return envio.fimVisto ? { ...base, turnoMsgId: null } : aplicarEvento(base, { nome: "estado", dados: { tarefa: r.tarefa } });
      });
      setLista((l) => {
        const item = l.find((i) => i.id === cid);
        if (!item) return l;
        return [{ ...item, atualizada: Date.now(), titulo: item.titulo === "Nova conversa" && titulo ? titulo : item.titulo }, ...l.filter((i) => i !== item)];
      });
      if (envio.cancelar) void cancelarTarefa(cid).catch(() => {});
    } catch (e) {
      if (ehCancelamento(e) || envio.cancelar) {
        // Cancelado antes de o servidor aceitar: a mensagem some e o que foi escrito volta para o campo.
        pendencias.current.delete(idCliente);
        atualizar(cid, (c) => ({ ...c, enviando: false,
          mensagens: mesclar(c.mensagens.filter((m) => m.id !== idCliente), [avisoLocal(`cancelado-${idCliente}`, AVISO_CANCELADO)]) }));
        if (cid === ativaRef.current) { setTexto((t) => t || textoMsg); setArquivos((a) => (a.length ? a : pend.files)); }
      } else falhar(textoDoErro(e)); // inclui o 409: a mensagem continua na tela, com o texto, para enviar de novo
    } finally {
      if (envios.current.get(cid) === envio) envios.current.delete(cid);
    }
  }, [atualizar, marcarMensagem]);

  const enviar = (forcado?: unknown) => {
    const doBotao = typeof forcado === "string";
    const msgTxt = doBotao ? forcado : texto.trim();
    const files = doBotao ? [] : arquivos;
    const cid = ativaId;
    if (!msgTxt && files.length === 0) return;
    if (estaOcupada(cache[cid] ?? conversaVazia(cid))) return;
    if (!doBotao) { setTexto(""); setArquivos([]); }
    const idCliente = uid();
    pendencias.current.set(idCliente, { files, chaves: files.map(() => undefined) });
    const msg: Mensagem = { id: idCliente, idCliente, tipo: "usuario", texto: msgTxt, envio: "enviando",
      anexos: files.map((f) => ({ nome: f.name, tamanho: f.size, status: "pendente", pct: 0 })) };
    atualizar(cid, (c) => ({ ...c, enviando: true, mensagens: [...c.mensagens, msg] }));
    void processarEnvio(cid, idCliente, msgTxt);
  };

  const reenviar = (msgId: string) => {
    const cid = ativaId;
    const m = cache[cid]?.mensagens.find((x) => x.id === msgId);
    if (!m || m.tipo !== "usuario" || estaOcupada(cache[cid])) return;
    atualizar(cid, (c) => ({ ...c, enviando: true, mensagens: c.mensagens.map((x) => (x.id === msgId && x.tipo === "usuario"
      ? { ...x, envio: "enviando" as const, erro: undefined, anexos: x.anexos.map((a) => (a.status === "erro" ? { ...a, status: "pendente" as const, pct: 0, erro: undefined } : a)) } : x)) }));
    void processarEnvio(cid, msgId, m.texto);
  };

  const descartar = (msgId: string) => {
    const cid = ativaId;
    const m = cache[cid]?.mensagens.find((x) => x.id === msgId);
    const p = pendencias.current.get(msgId);
    pendencias.current.delete(msgId);
    if (m?.tipo === "usuario" && !texto && arquivos.length === 0) { setTexto(m.texto); if (p) setArquivos(p.files); }
    atualizar(cid, (c) => ({ ...c, enviando: false, mensagens: c.mensagens.filter((x) => x.id !== msgId) }));
  };

  const removerAnexo = (msgId: string, indice: number) => {
    const cid = ativaId;
    const p = pendencias.current.get(msgId);
    if (p) { p.files.splice(indice, 1); p.chaves.splice(indice, 1); }
    atualizar(cid, (c) => ({ ...c, mensagens: c.mensagens.flatMap((m): Mensagem[] => {
      if (m.id !== msgId || m.tipo !== "usuario") return [m];
      const anexos = m.anexos.filter((_, i) => i !== indice);
      return anexos.length === 0 && !m.texto ? [] : [{ ...m, anexos }];
    }) }));
  };

  const gerar = async () => {
    const cid = ativaId;
    const c = cache[cid];
    if (cid === RASCUNHO || !c) return;
    const versao = (c.caso?.decks.length ?? 0) + 1;
    atualizar(cid, (x) => ({ ...x, enviando: true }));
    try {
      const r = await gerarSlides(cid);
      aceitaEm.current.set(cid, Date.now());
      atualizar(cid, (x) => ({ ...aplicarEvento({ ...x, enviando: false, turnoMsgId: null }, { nome: "estado", dados: { tarefa: r.tarefa } }),
        mensagens: mesclar(x.mensagens, [avisoLocal(`gerar-${r.tarefa.id}`, `Vou montar os slides (versão ${versao}).`)]) }));
    } catch (e) {
      const faltas = e instanceof ErroApi && Array.isArray(e.extra.faltas) ? (e.extra.faltas as unknown[]).filter((f): f is string => typeof f === "string") : [];
      const msg = textoDoErro(e) + (faltas.length ? ` Falta: ${faltas.join("; ")}.` : "");
      atualizar(cid, (x) => ({ ...x, enviando: false, mensagens: mesclar(x.mensagens, [avisoLocal(`erro-${uid()}`, msg, true)]) }));
    }
  };

  const cancelar = () => {
    const cid = ativaId;
    const envio = envios.current.get(cid);
    if (envio) { envio.cancelar = true; if (envio.fase === "upload") envio.ac.abort(); return; }
    if (cid !== RASCUNHO) void cancelarTarefa(cid).catch(() => {});
  };

  const marcarVisto = (faixa: Faixa) => {
    const cid = ativaId;
    atualizar(cid, (c) => ({ ...c, alertasVistos: c.alertasVistos.includes(faixa) ? c.alertasVistos : [...c.alertasVistos, faixa] }));
    void marcarAlertaVisto(cid, faixa).catch(() => { /* fica visto só nesta sessão */ });
  };

  // ---- Nova conversa e apagar ----

  const novaConversa = () => { setAtivaId(RASCUNHO); atualizarUrl(null); setFoco((f) => f + 1); };

  const apagar = async (c: ConversaResumo) => {
    const itens = lista;
    const idx = itens.findIndex((i) => i.id === c.id);
    const eraAtiva = ativaId === c.id;
    const proximo = eraAtiva ? (itens[idx + 1] ?? itens[idx - 1]) : undefined;
    setErroApagar(null);
    apagando.current.add(c.id);
    setLista((l) => l.filter((i) => i.id !== c.id));
    if (eraAtiva) { if (proximo) abrir(proximo.id); else { setAtivaId(RASCUNHO); atualizarUrl(null); setFoco((f) => f + 1); } }
    try {
      try { await apagarConversa(c.id); } catch (e) { if (!(e instanceof ErroApi && e.status === 404)) throw e; }
      setCache((cs) => { const n = { ...cs }; delete n[c.id]; return n; });
    } catch (e) {
      setLista((l) => (l.some((i) => i.id === c.id) ? l : [...l.slice(0, Math.max(0, idx)), c, ...l.slice(Math.max(0, idx))]));
      setErroApagar(`Não consegui apagar “${c.titulo}”. ${textoDoErro(e)}`);
    } finally { apagando.current.delete(c.id); }
  };

  // ---- Derivados ----

  const ativa = cache[ativaId] ?? conversaVazia(ativaId);
  const resumo = lista.find((i) => i.id === ativaId);
  const ocupada = estaOcupada(ativa);
  const ativaTarefa = tarefaAtiva(ativa.tarefa);
  const carregada = ativa.carga === "ok";
  const vazia = ativa.mensagens.length === 0 && carregada;
  const titulo = resumo?.titulo ?? ativa.titulo;
  const ctxTokens = ativa.contexto?.tokens ?? resumo?.ctxTokens;
  const ctxLimite = ativa.contexto?.limite ?? resumo?.ctxLimite;
  const ctxPct = ativaId !== RASCUNHO && carregada && ctxTokens != null && ctxLimite ? pctDe(ctxTokens, ctxLimite) : null;
  const estadoConexao = conexao.id === ativaId ? conexao.estado : "ok";
  const aviso = ativaTarefa && estadoConexao !== "ok" ? "Reconectando…" : undefined;
  const msgProgresso = ativa.progresso?.msg || ativa.atividade || "";
  const pctProgresso = ativa.progresso?.pct ?? null;
  const pendente: Pendente | null = ativaTarefa ? { parcial: ativa.parcial, msg: msgProgresso, pct: pctProgresso, fila: ativa.fila, aviso } : null;

  // Primeiro processamento de carteira + transcrição: mantém o círculo grande até o deck ficar pronto.
  const processandoPrimeira = ativaTarefa
    && ativa.mensagens.some((m) => m.tipo === "usuario" && m.anexos.length > 0)
    && !ativa.mensagens.some((m) => m.tipo === "resultado");
  // Ao terminar, a esfera grande fica na tela até voltar à forma normal (aoAssentar) e só então some a tela central.
  const [segurando, setSegurando] = useState(false);
  const [antes, setAntes] = useState(false);
  if (antes !== processandoPrimeira) { setAntes(processandoPrimeira); if (processandoPrimeira) setSegurando(true); }
  useEffect(() => {
    if (processandoPrimeira || !segurando) return;
    const t = setTimeout(() => setSegurando(false), 3000); // rede de segurança se a esfera não avisar
    return () => clearTimeout(t);
  }, [processandoPrimeira, segurando]);
  const central = carregada && (vazia || processandoPrimeira || segurando);

  return (
    <Flex h="100dvh" bg="neve" color="floresta"
      onDragEnter={(e) => { e.preventDefault(); profundidade.current++; setArrastando(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { profundidade.current = Math.max(0, profundidade.current - 1); if (!profundidade.current) setArrastando(false); }}
      onDrop={(e) => { e.preventDefault(); profundidade.current = 0; setArrastando(false); setArquivos((a) => [...a, ...Array.from(e.dataTransfer.files)]); }}>
      {menu && (
        <ConversaLista itens={lista} estado={estadoLista} temMais={cursor !== null} carregandoMais={carregandoMais} erroMais={erroMais}
          ativaId={ativaId === RASCUNHO ? null : ativaId} erroApagar={erroApagar}
          onSelecionar={abrir} onNova={novaConversa} onMais={() => void carregarMais()}
          onTentar={() => { setEstadoLista("carregando"); void buscarLista(); }} onApagar={(c) => void apagar(c)} />
      )}
      <Flex direction="column" flex="1" minW="0" position="relative">
        <Flex px="3" py="2" align="center" gap="2" minH="12">
          <IconButton aria-label="Alternar lista de conversas" variant="ghost" onClick={() => setMenu((m) => !m)} display={{ base: "none", md: "inline-flex" }}><LuMenu /></IconButton>
          {!vazia && carregada && <Text fontWeight="medium" truncate>{titulo}</Text>}
        </Flex>
        {ativa.carga === "carregando" ? (
          <Stack flex="1" w="full" maxW="820px" mx="auto" px="4" py="6" gap="6" aria-busy="true" aria-label="Abrindo a conversa">
            <Skeleton h="10" w="55%" alignSelf="flex-end" rounded="2xl" css={{ "--start-color": "colors.areia", "--end-color": "colors.nevoa" }} />
            <Skeleton h="16" w="80%" rounded="xl" css={{ "--start-color": "colors.areia", "--end-color": "colors.nevoa" }} />
            <Skeleton h="10" w="40%" rounded="xl" css={{ "--start-color": "colors.areia", "--end-color": "colors.nevoa" }} />
          </Stack>
        ) : ativa.carga === "erro" ? (
          <Flex flex="1" direction="column" align="center" justify="center" gap="3" px="4" textAlign="center" role="alert">
            <Text color="profundo">{ativa.erroCarga ?? "Não consegui abrir esta conversa."}</Text>
            <Button size="sm" variant="outline" borderColor="profundo" color="profundo" onClick={() => tentarConversa(ativaId)}>Tentar de novo</Button>
          </Flex>
        ) : central ? (
          // Uma única esfera na tela vazia, no processamento e na volta: assim ela não é recriada e a transição é contínua.
          <Flex flex="1" direction="column" align="center" justify="center" gap="5" px="4" textAlign="center">
            <AtlasOrb tamanho={140} crescimento={1.6} ampliar={processandoPrimeira} estado={ocupada ? "pensando" : "parado"} aoAssentar={() => setSegurando(false)} />
            {processandoPrimeira ? (
              <>
                <Heading size="2xl" color="profundo">Processando a carteira e a transcrição…</Heading>
                <ProgressMessage msg={msgProgresso} pct={pctProgresso} fila={ativa.fila} aviso={aviso} />
                <Button onClick={cancelar} variant="outline" borderColor="profundo" color="profundo" size="sm"><LuSquare /> Cancelar</Button>
              </>
            ) : vazia ? (
              <>
                <Heading size="2xl" color="profundo">Olá, sou o Atlas.</Heading>
                <Text color="floresta" maxW="440px">Anexe a carteira e a transcrição da R1. Eu leio os dois e, quando você pedir, monto o deck da R2 em PPTX e PDF.</Text>
              </>
            ) : null}
          </Flex>
        ) : (
          <MessageList key={ativaId} conversaId={ativaId} mensagens={ativa.mensagens} maisAntigas={ativa.maisAntigas} anteriores={ativa.anteriores}
            onCarregarAnteriores={() => void carregarAnteriores()} pendente={pendente}
            onReenviar={reenviar} onDescartar={descartar} onRemoverAnexo={removerAnexo} />
        )}
        {carregada && ativa.caso?.opcoes?.some((o) => o.id === "usar_transcricao") && !ocupada && !ativa.caso.prontidao.pronto && (
          <Flex w="full" maxW="820px" mx="auto" px="4" pb="2" align="center" gap="3">
            <Button onClick={() => enviar("usar a transcrição")} bg="profundo" color="neve" _hover={{ bg: "floresta" }}>
              {ativa.caso.opcoes.find((o) => o.id === "usar_transcricao")!.rotulo}
            </Button>
            <Text fontSize="sm" color="profundo">Ou anexe a carteira.</Text>
          </Flex>
        )}
        {carregada && ativa.caso?.prontidao.pronto && !ocupada && (
          <Flex w="full" maxW="820px" mx="auto" px="4" pb="2" align="center" gap="3">
            <Button onClick={() => void gerar()} bg="profundo" color="neve" _hover={{ bg: "floresta" }}>
              {ativa.caso.decks.length ? `Gerar nova versão (v${ativa.caso.decks.length + 1})` : "Gerar slides"}
            </Button>
            {ativa.caso.decks.length === 0 && <Text fontSize="sm" color="profundo">Os slides só saem quando você pedir.</Text>}
          </Flex>
        )}
        <Composer texto={texto} setTexto={setTexto} arquivos={arquivos} setArquivos={setArquivos} onEnviar={() => enviar()} onCancelar={cancelar}
          desabilitado={ocupada} foco={foco}
          medidor={<ContextoMedidor tokens={ctxPct == null ? undefined : ctxTokens} limite={ctxPct == null ? undefined : ctxLimite}
            estimado={ativa.contexto?.estimado} partes={ativa.contexto?.partes} />}
          alerta={<ContextoAlerta pct={ctxPct} vistos={ativa.alertasVistos} onVisto={marcarVisto} />} />
        {arrastando && (
          <Flex position="absolute" inset="0" bg="rgba(0,64,49,.88)" color="neve" align="center" justify="center" zIndex="10" pointerEvents="none" rounded="xl" m="2" borderWidth="2px" borderStyle="dashed" borderColor="menta">
            <Heading size="xl">Solte aqui a carteira e a transcrição</Heading>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
