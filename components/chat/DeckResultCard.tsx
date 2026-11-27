"use client";
import { Box, Button, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { LuDownload } from "react-icons/lu";
import { urlDeck } from "./api";
import { WarningsPanel } from "./WarningsPanel";
import type { Resultado } from "./types";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function DeckResultCard({ conversaId, versao, r }: { conversaId: string; versao?: number; r: Resultado }) {
  const pptx = r.arquivos.pptx ? urlDeck(conversaId, versao, "pptx", r.arquivos.pptx) : null;
  const pdf = r.arquivos.pdf ? urlDeck(conversaId, versao, "pdf", r.arquivos.pdf) : null;
  return (
    <Stack gap="3" w="full" maxW="640px">
      <Box bg="white" borderWidth="1px" borderColor="nevoa" rounded="xl" p="4" shadow="xs">
        <Text fontSize="xs" color="eqi" fontWeight="semibold" letterSpacing="wider">DECK DA R2 PRONTO</Text>
        <Heading size="lg" color="profundo" mt="1">{r.resumo.lead}</Heading>
        <Flex gap="6" mt="2" wrap="wrap" fontSize="sm">
          <Box><Text color="gray.600">Patrimônio do estudo</Text><Text fontWeight="semibold">{brl(r.resumo.total)}</Text></Box>
          <Box><Text color="gray.600">Perfil</Text><Text fontWeight="semibold">{r.resumo.perfil}</Text></Box>
        </Flex>
        <Flex gap="2" mt="4" wrap="wrap">
          {pptx && (
            <Button asChild bg="profundo" color="neve" _hover={{ bg: "floresta" }}>
              <a href={pptx} download><LuDownload /> Baixar PPTX</a>
            </Button>
          )}
          {pdf && (
            <Button asChild variant="outline" borderColor="profundo" color="profundo">
              <a href={pdf} download><LuDownload /> Baixar PDF</a>
            </Button>
          )}
        </Flex>
      </Box>
      <WarningsPanel titulo="Avisos do método" itens={r.avisos} destaque />
      <WarningsPanel titulo="Pendências a validar antes da R2" itens={r.pendencias} />
    </Stack>
  );
}
