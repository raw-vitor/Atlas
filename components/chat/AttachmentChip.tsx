"use client";
import { Box, Flex, IconButton, Text } from "@chakra-ui/react";
import { LuFileText, LuRotateCw, LuTriangleAlert, LuX } from "react-icons/lu";
import type { AnexoUI } from "./types";

interface Props {
  nome: string;
  /** Estado do envio ao servidor. Sem ele, o chip é só o nome do arquivo (campo de texto e mensagens antigas). */
  estado?: Pick<AnexoUI, "status" | "pct" | "erro">;
  onRemover?: () => void;
  onRepetir?: () => void;
}

export function AttachmentChip({ nome, estado, onRemover, onRepetir }: Props) {
  const enviando = estado?.status === "subindo" || estado?.status === "pendente";
  const falhou = estado?.status === "erro";
  const pct = estado?.status === "subindo" ? estado.pct : 0;
  return (
    <Flex position="relative" overflow="hidden" align="center" gap="2" bg="areia" borderWidth="1px" borderColor={falhou ? "red.600" : "nevoa"}
      rounded="lg" px="2.5" py="1.5" maxW="240px" title={falhou ? estado?.erro : nome}>
      {falhou ? <LuTriangleAlert color="#C53030" aria-hidden /> : <LuFileText color="#004031" aria-hidden />}
      <Text fontSize="sm" truncate>{nome}</Text>
      {enviando && <Text fontSize="xs" color="profundo" flexShrink={0} aria-label={`Enviando ${nome}: ${pct}%`}>{pct}%</Text>}
      {falhou && onRepetir && (
        <IconButton aria-label={`Tentar de novo ${nome}`} size="2xs" variant="ghost" onClick={onRepetir}><LuRotateCw /></IconButton>
      )}
      {onRemover && (
        <IconButton aria-label={`Remover ${nome}`} size="2xs" variant="ghost" onClick={onRemover}><LuX /></IconButton>
      )}
      {/* Barra no rodapé do chip: não muda o tamanho dele. */}
      {enviando && (
        <Box position="absolute" left="0" bottom="0" h="2px" bg="eqi" w={`${pct}%`} transition="width 0.2s" role="progressbar"
          aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Envio de ${nome}`} />
      )}
    </Flex>
  );
}
