"use client";
import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { AtlasOrb } from "@/components/atlas/AtlasOrb";
import { AttachmentChip } from "./AttachmentChip";
import { DeckResultCard } from "./DeckResultCard";
import { ProgressMessage } from "./ProgressMessage";
import type { Mensagem } from "./types";

function Atlas({ children, estado = "parado" as const, animado = false }: { children: React.ReactNode; estado?: "parado" | "pensando" | "erro"; animado?: boolean }) {
  return (
    <Flex gap="3" align="flex-start">
      <Box pt="1"><AtlasOrb tamanho={28} estado={estado} animado={animado} /></Box>
      <Box flex="1" minW="0">{children}</Box>
    </Flex>
  );
}

export function MessageList({ mensagens }: { mensagens: Mensagem[] }) {
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => { fim.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [mensagens]);
  // Só o último avatar do Atlas anima; os anteriores ficam estáticos.
  const ultimoAtlas = mensagens.reduce((u, m, i) => (m.tipo === "usuario" ? u : i), -1);
  return (
    <Stack gap="6" w="full" maxW="820px" mx="auto" px="4" py="6" aria-live="polite">
      {mensagens.map((m, idx) => {
        if (m.tipo === "usuario")
          return (
            <Flex key={m.id} justify="flex-end">
              <Stack align="flex-end" gap="2" maxW="85%">
                {m.anexos.length > 0 && <Flex gap="2" wrap="wrap" justify="flex-end">{m.anexos.map((a, i) => <AttachmentChip key={i} nome={a} />)}</Flex>}
                {m.texto && <Box bg="areia" rounded="2xl" px="4" py="2"><Text className="atlas-msg">{m.texto}</Text></Box>}
              </Stack>
            </Flex>
          );
        if (m.tipo === "atlas")
          return <Atlas key={m.id} estado={m.erro ? "erro" : "parado"} animado={idx === ultimoAtlas}><Text className="atlas-msg" color={m.erro ? "red.700" : undefined}>{m.texto}</Text></Atlas>;
        if (m.tipo === "progresso")
          return <Atlas key={m.id} estado="pensando" animado><ProgressMessage evento={m.evento} /></Atlas>;
        return <Atlas key={m.id} animado={idx === ultimoAtlas}><DeckResultCard jobId={m.jobId} r={m.resultado} /></Atlas>;
      })}
      <div ref={fim} />
    </Stack>
  );
}
