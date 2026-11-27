"use client";
import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { AtlasOrb } from "@/components/atlas/AtlasOrb";
import { AttachmentChip } from "./AttachmentChip";
import { DeckResultCard } from "./DeckResultCard";
import { ProgressMessage } from "./ProgressMessage";
import type { ConversaUI, Mensagem } from "./types";

function Atlas({ children, estado = "parado" as const, animado = false }: { children: React.ReactNode; estado?: "parado" | "pensando" | "erro"; animado?: boolean }) {
  return (
    <Flex gap="3" align="flex-start">
      <Box pt="1"><AtlasOrb tamanho={28} estado={estado} animado={animado} /></Box>
      <Box flex="1" minW="0">{children}</Box>
    </Flex>
  );
}

export interface Pendente { parcial: string | null; msg: string; pct: number | null; fila: number | null; aviso?: string }

interface Props {
  conversaId: string;
  mensagens: Mensagem[];
  maisAntigas: boolean;
  anteriores: ConversaUI["anteriores"];
  onCarregarAnteriores: () => void;
  /** Resposta em andamento (progresso ou texto parcial). */
  pendente: Pendente | null;
  onReenviar: (msgId: string) => void;
  onDescartar: (msgId: string) => void;
  onRemoverAnexo: (msgId: string, indice: number) => void;
}

const PERTO_DO_FIM_PX = 160;

export function MessageList({ conversaId, mensagens, maisAntigas, anteriores, onCarregarAnteriores, pendente, onReenviar, onDescartar, onRemoverAnexo }: Props) {
  const cont = useRef<HTMLDivElement>(null);
  const topo = useRef<HTMLDivElement>(null);
  const perto = useRef(true);
  const montado = useRef(false);
  // Posição de rolagem antes de carregar mensagens anteriores, para o conteúdo não pular quando elas entram no topo.
  const ancora = useRef<{ altura: number; topo: number } | null>(null);

  const primeiroId = mensagens[0]?.id;
  const ultimo = mensagens[mensagens.length - 1];
  const chaveFim = `${ultimo?.id}|${pendente ? 1 : 0}|${pendente?.parcial?.length ?? 0}`;

  useLayoutEffect(() => {
    const el = cont.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversaId]);

  useLayoutEffect(() => {
    const el = cont.current, a = ancora.current;
    if (el && a) { el.scrollTop = a.topo + (el.scrollHeight - a.altura); ancora.current = null; }
  }, [primeiroId]);

  useLayoutEffect(() => { if (anteriores !== "carregando") ancora.current = null; }, [anteriores]);

  useEffect(() => {
    if (!montado.current) { montado.current = true; return; }
    const el = cont.current;
    if (!el) return;
    if (ultimo?.tipo === "usuario" || perto.current) {
      const reduz = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ top: el.scrollHeight, behavior: reduz ? "auto" : "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveFim]);

  const carregar = useCallback(() => {
    const el = cont.current;
    if (el) ancora.current = { altura: el.scrollHeight, topo: el.scrollTop };
    onCarregarAnteriores();
  }, [onCarregarAnteriores]);

  useEffect(() => {
    const alvo = topo.current;
    if (!maisAntigas || anteriores !== "ocioso" || !alvo) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) carregar(); }, { root: cont.current, rootMargin: "120px 0px 0px 0px" });
    io.observe(alvo);
    return () => io.disconnect();
  }, [maisAntigas, anteriores, carregar]);

  // Só o último avatar do Atlas anima; os anteriores ficam estáticos.
  const ultimoAtlas = pendente ? -1 : mensagens.reduce((u, m, i) => (m.tipo === "usuario" ? u : i), -1);
  return (
    <Box ref={cont} flex="1" overflowY="auto" css={{ overflowAnchor: "none" }}
      onScroll={(e) => { const t = e.currentTarget; perto.current = t.scrollHeight - t.scrollTop - t.clientHeight < PERTO_DO_FIM_PX; }}>
      <Stack gap="6" w="full" maxW="820px" mx="auto" px="4" py="6" aria-live={anteriores === "carregando" ? "off" : "polite"}>
        {(maisAntigas || anteriores !== "ocioso") && (
          <Flex ref={topo} justify="center" align="center" minH="6" mt="-3" mb="-3" fontSize="xs" color="profundo">
            {anteriores === "carregando" && <Text>Carregando mensagens anteriores…</Text>}
            {anteriores === "erro" && (
              <Flex align="center" gap="2"><Text>Não consegui carregar as anteriores.</Text>
                <Button size="2xs" variant="ghost" color="profundo" onClick={carregar}>Tentar de novo</Button></Flex>
            )}
          </Flex>
        )}
        {mensagens.map((m, idx) => {
          if (m.tipo === "usuario")
            return (
              <Flex key={m.id} justify="flex-end">
                <Stack align="flex-end" gap="2" maxW="85%">
                  {m.anexos.length > 0 && (
                    <Flex gap="2" wrap="wrap" justify="flex-end">
                      {m.anexos.map((a, i) => (
                        <AttachmentChip key={`${a.nome}-${i}`} nome={a.nome} estado={m.envio ? a : undefined}
                          onRemover={m.envio === "falhou" && a.status === "erro" ? () => onRemoverAnexo(m.id, i) : undefined}
                          onRepetir={m.envio === "falhou" && a.status === "erro" ? () => onReenviar(m.id) : undefined} />
                      ))}
                    </Flex>
                  )}
                  {m.texto && <Box bg="areia" rounded="2xl" px="4" py="2" opacity={m.envio === "enviando" ? 0.7 : 1} transition="opacity 0.15s"><Text className="atlas-msg">{m.texto}</Text></Box>}
                  {m.envio === "falhou" && (
                    <Flex align="center" gap="2" wrap="wrap" justify="flex-end">
                      <Text fontSize="xs" color="red.600" role="alert">{m.erro ?? "Não consegui enviar."}</Text>
                      <Button size="2xs" variant="outline" borderColor="profundo" color="profundo" onClick={() => onReenviar(m.id)}>Tentar de novo</Button>
                      <Button size="2xs" variant="ghost" color="profundo" onClick={() => onDescartar(m.id)}>Descartar</Button>
                    </Flex>
                  )}
                </Stack>
              </Flex>
            );
          if (m.tipo === "atlas")
            return <Atlas key={m.id} estado={m.erro ? "erro" : "parado"} animado={idx === ultimoAtlas}><Text className="atlas-msg" color={m.erro ? "red.700" : undefined}>{m.texto}</Text></Atlas>;
          return <Atlas key={m.id} animado={idx === ultimoAtlas}><DeckResultCard conversaId={conversaId} versao={m.versao} r={m.resultado} /></Atlas>;
        })}
        {pendente && (
          <Atlas estado="pensando" animado>
            {pendente.parcial
              ? <Text className="atlas-msg">{pendente.parcial}</Text>
              : <ProgressMessage msg={pendente.msg} pct={pendente.pct} fila={pendente.fila} aviso={pendente.aviso} />}
          </Atlas>
        )}
      </Stack>
    </Box>
  );
}
