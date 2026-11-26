"use client";
import { Box, Progress, Text } from "@chakra-ui/react";
import type { Evento } from "./types";

export function ProgressMessage({ evento }: { evento: Evento | null }) {
  const pct = evento?.pct ?? 0;
  return (
    <Box w="full" maxW="420px">
      <Text fontSize="sm" mb="2">{evento?.msg || "Na fila"}…</Text>
      <Progress.Root value={pct} size="sm" colorPalette="green" aria-label="Progresso do deck">
        <Progress.Track bg="nevoa"><Progress.Range bg="eqi" /></Progress.Track>
      </Progress.Root>
      <Text fontSize="xs" color="profundo" mt="1">{pct}%</Text>
    </Box>
  );
}
