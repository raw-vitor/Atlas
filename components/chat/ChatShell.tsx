"use client";
import { Box, Button, Flex, Heading, IconButton, Stack, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuMenu, LuPlus, LuSquare } from "react-icons/lu";
import { ProgressMessage } from "./ProgressMessage";
import { AtlasOrb } from "@/components/atlas/AtlasOrb";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { lerSSE } from "./sse";
import type { CasoPublico, Conversa, Evento, Mensagem } from "./types";

const uid = () => Math.random().toString(36).slice(2, 10);
const nova = (): Conversa => ({ id: uid(), titulo: "Nova conversa", mensagens: [], ocupada: false });

export function ChatShell() {
  // v1: sem login e sem histórico persistente. As conversas existem só na memória desta aba.
  const [conversas, setConversas] = useState<Conversa[]>(() => [nova()]);
  const [ativaId, setAtivaId] = useState(() => conversas[0].id);
  const [menu, setMenu] = useState(true);
  const [texto, setTexto] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const fontes = useRef(new Map<string, EventSource>());
  // O que dá para cancelar em cada conversa: o envio em andamento (AbortController) ou o job de geração do deck.
  const cancelaveis = useRef(new Map<string, { ac?: AbortController; jobId?: string }>());
  const profundidade = useRef(0);

  const ativa = conversas.find((c) => c.id === ativaId) ?? conversas[0];
  const casoAtivoId = ativa.caso?.id;

  const atualizar = useCallback((cid: string, fn: (c: Conversa) => Conversa) =>
    setConversas((cs) => cs.map((c) => (c.id === cid ? fn(c) : c))), []);

  useEffect(() => { const f = fontes.current; return () => f.forEach((e) => e.close()); }, []);

  const casoIds = useRef(new Map<string, string>());
  const refrescar = useCallback(async (cid: string) => {
    const casoId = casoIds.current.get(cid);
    if (!casoId) return;
    try {
      const r = await fetch(`/api/conversas/${casoId}`);
      if (r.ok) { const caso: CasoPublico = await r.json(); atualizar(cid, (c) => ({ ...c, caso })); }
    } catch { /* o botão só fica desatualizado */ }
  }, [atualizar]);

  const acompanhar = useCallback((cid: string, jobId: string, msgId: string) => {
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    fontes.current.set(jobId, es);
    const fechar = () => { es.close(); fontes.current.delete(jobId); };
    es.onmessage = (ev) => {
      const e: Evento = JSON.parse(ev.data);
      if (e.status === "pronto" && e.resultado) {
        const r = e.resultado;
        atualizar(cid, (c) => ({ ...c, ocupada: false, titulo: `R2 · ${r.resumo.lead}`,
          mensagens: c.mensagens.map((m): Mensagem => (m.id === msgId ? { id: msgId, tipo: "resultado", jobId, resultado: r } : m)) }));
        cancelaveis.current.delete(cid);
        void refrescar(cid);
        fechar();
      } else if (e.status === "cancelado") {
        cancelaveis.current.delete(cid);
        atualizar(cid, (c) => ({ ...c, ocupada: false,
          mensagens: c.mensagens.map((m): Mensagem => (m.id === msgId ? { id: msgId, tipo: "atlas", texto: "Geração dos slides cancelada." } : m)) }));
        void refrescar(cid);
        fechar();
      } else if (e.status === "erro") {
        cancelaveis.current.delete(cid);
        atualizar(cid, (c) => ({ ...c, ocupada: false,
          mensagens: c.mensagens.map((m): Mensagem => (m.id === msgId ? { id: msgId, tipo: "atlas", erro: true, texto: `Não consegui terminar o deck.\n${e.erro}` } : m)) }));
        void refrescar(cid);
        fechar();
      } else {
        atualizar(cid, (c) => ({ ...c, mensagens: c.mensagens.map((m): Mensagem => (m.id === msgId ? { id: msgId, tipo: "progresso", jobId, evento: e } : m)) }));
      }
    };
    es.onerror = () => {
      // o navegador reconecta sozinho; se o job já sumiu (404), encerra
      if (es.readyState === EventSource.CLOSED) {
        atualizar(cid, (c) => ({ ...c, ocupada: false,
          mensagens: c.mensagens.map((m): Mensagem => (m.id === msgId && m.tipo === "progresso" ? { id: msgId, tipo: "atlas", erro: true, texto: "Perdi a conexão com o andamento do deck. Envie de novo." } : m)) }));
        fontes.current.delete(jobId);
      }
    };
  }, [atualizar, refrescar]);

  /** fetch com a tentativa de login por token quando o acesso é protegido (ATLAS_ACCESS_TOKEN). */
  const chamar = useCallback(async (url: string, init: RequestInit): Promise<Response> => {
    let r = await fetch(url, init);
    if (r.status === 401) {
      const token = window.prompt("Token de acesso ao Atlas");
      if (token) {
        const l = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        if (l.ok) r = await fetch(url, init);
      }
    }
    return r;
  }, []);

  const falhar = useCallback((cid: string, texto: string, pid?: string) =>
    atualizar(cid, (c) => ({ ...c, ocupada: false,
      mensagens: [...c.mensagens.filter((m) => m.id !== pid), { id: uid(), tipo: "atlas", erro: true, texto }] })), [atualizar]);

  const enviar = useCallback(async (forcado?: unknown) => {
    const cid = ativa.id;
    const doBotao = typeof forcado === "string";
    const msgTxt = doBotao ? forcado : texto.trim();
    const anexos = doBotao ? [] : arquivos;
    if (!doBotao) { setTexto(""); setArquivos([]); }
    const pid = uid(), idUsuario = uid();
    const ac = new AbortController();
    cancelaveis.current.set(cid, { ac });
    atualizar(cid, (c) => ({ ...c, ocupada: true,
      mensagens: [...c.mensagens, { id: idUsuario, tipo: "usuario", texto: msgTxt, anexos: anexos.map((f) => f.name) }] }));
    try {
      let casoId = casoAtivoId;
      if (!casoId) {
        const rc = await chamar("/api/conversas", { method: "POST", signal: ac.signal });
        if (!rc.ok) return falhar(cid, "Não consegui abrir a conversa. Tente de novo.");
        const j = await rc.json(); casoId = j.id as string; casoIds.current.set(cid, casoId);
        atualizar(cid, (c) => ({ ...c, caso: j.caso }));
      }
      const fd = new FormData();
      fd.set("message", msgTxt);
      anexos.forEach((f) => fd.append("files", f));
      const r = await chamar(`/api/conversas/${casoId}/mensagens`, { method: "POST", body: fd, signal: ac.signal });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        return falhar(cid, r.status === 404 ? "Esta conversa expirou no servidor. Abra uma nova conversa e envie os arquivos de novo." : (j.erro ?? "Algo deu errado."));
      }
      if (anexos.length) atualizar(cid, (c) => ({ ...c, mensagens: [...c.mensagens, { id: pid, tipo: "progresso", jobId: "", evento: null }] }));
      const semProgresso = (c: Conversa) => c.mensagens.filter((m) => m.id !== pid);
      await lerSSE(r, (ev, d) => {
        const dados = d as { pct?: number; msg?: string; texto?: string; mensagem?: string };
        if (ev === "atividade")
          atualizar(cid, (c) => ({ ...c, mensagens: c.mensagens.map((m): Mensagem => (m.id === pid ? { id: pid, tipo: "progresso", jobId: "",
            evento: { id: "", status: "rodando", etapa: "", pct: dados.pct ?? 0, msg: dados.msg ?? "", erro: "", resultado: null } } : m)) }));
        else if (ev === "texto")
          atualizar(cid, (c) => ({ ...c, mensagens: [...semProgresso(c), { id: uid(), tipo: "atlas", texto: dados.texto ?? "" }] }));
        else if (ev === "caso") atualizar(cid, (c) => ({ ...c, caso: d as CasoPublico, titulo: (d as CasoPublico).lead ? `R2 · ${(d as CasoPublico).lead!.nome}` : c.titulo }));
        else if (ev === "erro") falhar(cid, dados.mensagem ?? "Algo deu errado.", pid);
      });
      atualizar(cid, (c) => ({ ...c, ocupada: false, mensagens: semProgresso(c) }));
    } catch {
      if (ac.signal.aborted) {
        // Cancelado: a mensagem some da conversa (o servidor também desfaz) e o que o assessor escreveu volta para o campo.
        atualizar(cid, (c) => ({ ...c, ocupada: false, mensagens: [...c.mensagens.filter((m) => m.id !== idUsuario && m.id !== pid),
          { id: uid(), tipo: "atlas", texto: "Cancelado. Nada foi alterado na conversa." }] }));
        if (!doBotao) { setTexto((t) => t || msgTxt); setArquivos((a) => (a.length ? a : anexos)); }
        void refrescar(cid);
      } else falhar(cid, "Não consegui falar com o servidor. Tente de novo.", pid);
    } finally {
      if (cancelaveis.current.get(cid)?.ac === ac) cancelaveis.current.delete(cid);
    }
  }, [ativa.id, casoAtivoId, texto, arquivos, atualizar, chamar, falhar, refrescar]);

  const gerar = useCallback(async () => {
    const cid = ativa.id, casoId = casoAtivoId;
    if (!casoId) return;
    atualizar(cid, (c) => ({ ...c, ocupada: true }));
    try {
      const r = await chamar(`/api/conversas/${casoId}/acoes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "gerar" }) });
      const j = await r.json();
      if (!r.ok) return falhar(cid, j.erro ?? "Não consegui gerar os slides.");
      const pid = uid();
      atualizar(cid, (c) => ({ ...c, caso: j.caso, mensagens: [...c.mensagens,
        { id: uid(), tipo: "atlas", texto: `Vou montar os slides (versão ${j.versao}).${j.refazRascunho ? " Primeiro escrevo o rascunho, o que leva cerca de 1 minuto." : ""}` },
        { id: pid, tipo: "progresso", jobId: j.jobId, evento: null }] }));
      cancelaveis.current.set(cid, { jobId: j.jobId });
      acompanhar(cid, j.jobId, pid);
    } catch { falhar(cid, "Não consegui falar com o servidor. Tente de novo."); }
  }, [ativa.id, casoAtivoId, atualizar, chamar, falhar, acompanhar]);

  const cancelar = useCallback(() => {
    const c = cancelaveis.current.get(ativa.id);
    if (c?.ac) c.ac.abort();
    else if (c?.jobId) void chamar(`/api/jobs/${c.jobId}/cancelar`, { method: "POST" }).catch(() => {});
  }, [ativa.id, chamar]);

  const novaConversa = () => { const c = nova(); setConversas((cs) => [c, ...cs]); setAtivaId(c.id); };
  const vazia = ativa.mensagens.length === 0;
  // Primeiro processamento de carteira + transcrição: mantém o círculo grande até o deck ficar pronto.
  const processandoPrimeira = ativa.ocupada
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
  const central = vazia || processandoPrimeira || segurando;
  const progresso = ativa.mensagens.findLast((m) => m.tipo === "progresso");

  return (
    <Flex h="100dvh" bg="neve" color="floresta"
      onDragEnter={(e) => { e.preventDefault(); profundidade.current++; setArrastando(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { profundidade.current = Math.max(0, profundidade.current - 1); if (!profundidade.current) setArrastando(false); }}
      onDrop={(e) => { e.preventDefault(); profundidade.current = 0; setArrastando(false); setArquivos((a) => [...a, ...Array.from(e.dataTransfer.files)]); }}>
      {menu && (
        <Flex direction="column" w="260px" bg="areia" borderRightWidth="1px" borderColor="nevoa" p="3" gap="3" display={{ base: "none", md: "flex" }}>
          <Flex align="center" gap="2"><AtlasOrb tamanho={24} /><Heading size="md" color="profundo">Atlas</Heading></Flex>
          <Button onClick={novaConversa} variant="outline" borderColor="profundo" color="profundo" justifyContent="flex-start"><LuPlus /> Nova conversa</Button>
          <Stack gap="1" overflowY="auto" flex="1">
            {conversas.map((c) => (
              <Button key={c.id} variant={c.id === ativa.id ? "subtle" : "ghost"} justifyContent="flex-start" size="sm" onClick={() => setAtivaId(c.id)} truncate>{c.titulo}</Button>
            ))}
          </Stack>
          <Text fontSize="xs" color="profundo">As conversas ficam só nesta aba.</Text>
        </Flex>
      )}
      <Flex direction="column" flex="1" minW="0" position="relative">
        <Flex px="3" py="2" align="center" gap="2">
          <IconButton aria-label="Alternar lista de conversas" variant="ghost" onClick={() => setMenu((m) => !m)} display={{ base: "none", md: "inline-flex" }}><LuMenu /></IconButton>
          {!vazia && <Text fontWeight="medium" truncate>{ativa.titulo}</Text>}
        </Flex>
        {central ? (
          // Uma única esfera na tela vazia, no processamento e na volta: assim ela não é recriada e a transição é contínua.
          <Flex flex="1" direction="column" align="center" justify="center" gap="5" px="4" textAlign="center">
            <AtlasOrb tamanho={140} crescimento={1.6} ampliar={processandoPrimeira} estado={ativa.ocupada ? "pensando" : "parado"} aoAssentar={() => setSegurando(false)} />
            {processandoPrimeira ? (
              <>
                <Heading size="2xl" color="profundo">Processando a carteira e a transcrição…</Heading>
                <ProgressMessage evento={progresso?.tipo === "progresso" ? progresso.evento : null} />
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
          <Box flex="1" overflowY="auto"><MessageList mensagens={ativa.mensagens} /></Box>
        )}
        {ativa.caso?.opcoes?.some((o) => o.id === "usar_transcricao") && !ativa.ocupada && !ativa.caso.prontidao.pronto && (
          <Flex w="full" maxW="820px" mx="auto" px="4" pb="2" align="center" gap="3">
            <Button onClick={() => void enviar("usar a transcrição")} bg="profundo" color="neve" _hover={{ bg: "floresta" }}>
              {ativa.caso.opcoes.find((o) => o.id === "usar_transcricao")!.rotulo}
            </Button>
            <Text fontSize="sm" color="profundo">Ou anexe a carteira.</Text>
          </Flex>
        )}
        {ativa.caso?.prontidao.pronto && !ativa.ocupada && (
          <Flex w="full" maxW="820px" mx="auto" px="4" pb="2" align="center" gap="3">
            <Button onClick={gerar} bg="profundo" color="neve" _hover={{ bg: "floresta" }}>
              {ativa.caso.decks.length ? `Gerar nova versão (v${ativa.caso.decks.length + 1})` : "Gerar slides"}
            </Button>
            {ativa.caso.decks.length === 0 && <Text fontSize="sm" color="profundo">Os slides só saem quando você pedir.</Text>}
          </Flex>
        )}
        <Composer texto={texto} setTexto={setTexto} arquivos={arquivos} setArquivos={setArquivos} onEnviar={enviar} onCancelar={cancelar} desabilitado={ativa.ocupada} />
        {arrastando && (
          <Flex position="absolute" inset="0" bg="rgba(0,64,49,.88)" color="neve" align="center" justify="center" zIndex="10" pointerEvents="none" rounded="xl" m="2" borderWidth="2px" borderStyle="dashed" borderColor="menta">
            <Heading size="xl">Solte aqui a carteira e a transcrição</Heading>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
