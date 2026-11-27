"use client";
import { Box, Progress, Text } from "@chakra-ui/react";

/** `pct` null = andamento sem porcentagem (barra indeterminada). `fila` mostra "Na fila, posição N". */
export function ProgressMessage({ msg, pct, fila, aviso }: { msg?: string; pct: number | null; fila?: number | null; aviso?: string }) {
  const texto = fila != null ? `Na fila, posição ${fila}` : `${msg || "Trabalhando"}…`;
  return (
    <Box w="full" maxW="420px">
      <Text fontSize="sm" mb="2">{texto}</Text>
      <Progress.Root value={pct} size="sm" colorPalette="green" aria-label="Progresso">
        <Progress.Track bg="nevoa"><Progress.Range bg="eqi" /></Progress.Track>
      </Progress.Root>
      {/* Linha de altura fixa: o texto entra e sai sem deslocar o que está abaixo. */}
      <Text fontSize="xs" color="profundo" mt="1" minH="1lh">{aviso ?? (pct != null ? `${pct}%` : "")}</Text>
    </Box>
  );
}
