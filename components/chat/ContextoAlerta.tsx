"use client";
import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { alertaPendente, faixaDe, textoAlerta } from "./contexto";
import type { Faixa } from "./types";

/**
 * Faixa discreta acima do composer (60, 85 e 95%). Cada faixa aparece uma vez por conversa; fechar a marca como vista.
 * O espaço é reservado assim que a conversa passa de 60%, e o aparecer/sumir é só de opacidade: a lista não se mexe
 * e o foco do campo de texto não é tocado.
 */
export function ContextoAlerta({ pct, vistos, onVisto }: { pct: number | null; vistos: readonly Faixa[]; onVisto: (f: Faixa) => void }) {
  const faixa = pct == null ? null : faixaDe(pct);
  if (pct == null || !faixa) return null;
  const visivel = alertaPendente(pct, vistos) !== null;
  const critico = faixa === 95;
  return (
    <Box w="full" maxW="820px" mx="auto" px="4" pb="2" aria-live="polite" aria-atomic="true">
      <Flex minH="11" align="center">
        <Flex w="full" align="center" gap="3" rounded="lg" px="3" py="2" bg={critico ? "contexto.critico.bg" : "contexto.alerta.bg"}
          color={critico ? "contexto.critico.fg" : "floresta"} borderWidth="1px" borderColor={critico ? "contexto.critico.bg" : "nevoa"}
          opacity={visivel ? 1 : 0} visibility={visivel ? "visible" : "hidden"}
          transition="opacity 0.25s ease, visibility 0s linear" css={{ transitionDelay: visivel ? "0s" : "0s, 0.25s" }}>
          {faixa >= 85 && <Text fontSize="xs" fontWeight="bold" letterSpacing="wider" flexShrink={0}>ATENÇÃO</Text>}
          <Text fontSize="sm" flex="1" minW="0">{textoAlerta(faixa, pct)}</Text>
          <Button size="2xs" variant="ghost" flexShrink={0} color="inherit" _hover={{ bg: critico ? "profundo" : "nevoa" }} onClick={() => onVisto(faixa)}>
            {critico ? "Fechar" : "Entendi"}
          </Button>
        </Flex>
      </Flex>
    </Box>
  );
}
