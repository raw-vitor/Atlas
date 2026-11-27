"use client";
import { Box, Button, Flex, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import { useState } from "react";
import type { ConfigVersoes } from "@/lib/prompt-tipos";
import { TEXTO_VERSAO_ANTERIOR, chaveDispensa, hrefConfig, versaoDesatualizada } from "./configPrompt";

/** Dispensar vale só nesta aba (sessionStorage); sem storage disponível (modo privado, bloqueio) vale até recarregar. */
const dispensada = (chave: string) => { try { return window.sessionStorage.getItem(chave) === "1"; } catch { return false; } };
const lembrar = (chave: string) => { try { window.sessionStorage.setItem(chave, "1"); } catch { /* fica só no estado */ } };

/**
 * Faixa fina no topo da conversa: ela foi gerada com outra versão das instruções do assessor.
 * Só avisa; não regenera nada. Mesmo visual do `ContextoAlerta`. Use `key={conversaId}` para o estado não vazar entre conversas.
 */
export function ConfigAlerta({ conversaId, versoes, atual }: { conversaId: string; versoes: ConfigVersoes | undefined; atual: number | null }) {
  const chave = chaveDispensa(conversaId, versoes, atual);
  const [fechadas, setFechadas] = useState<string[]>([]);
  if (!versaoDesatualizada(versoes, atual)) return null;
  if (fechadas.includes(chave) || dispensada(chave)) return null;
  return (
    <Box w="full" maxW="820px" mx="auto" px="4" pb="2" role="status" aria-live="polite" aria-atomic="true">
      <Flex align="center" gap="3" rounded="lg" px="3" py="2" bg="contexto.alerta.bg" color="floresta" borderWidth="1px" borderColor="nevoa">
        <Text display={{ base: "none", sm: "block" }} fontSize="xs" fontWeight="bold" letterSpacing="wider" color="profundo" flexShrink={0}>ATENÇÃO</Text>
        <Text fontSize={{ base: "xs", sm: "sm" }} flex="1" minW="0">
          {TEXTO_VERSAO_ANTERIOR}{" "}
          <NextLink href={hrefConfig(conversaId)} style={{ textDecoration: "underline", fontWeight: 500, whiteSpace: "nowrap" }}>Ver suas instruções</NextLink>
        </Text>
        <Button size="xs" variant="ghost" flexShrink={0} color="inherit" _hover={{ bg: "nevoa" }}
          onClick={() => { lembrar(chave); setFechadas((f) => [...f, chave]); }}>
          Entendi
        </Button>
      </Flex>
    </Box>
  );
}
