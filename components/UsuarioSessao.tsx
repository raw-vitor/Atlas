"use client";
import { Box, Flex, Link, Text, VisuallyHidden } from "@chakra-ui/react";

/** Rota do Cloudflare Access que encerra a sessão neste host. Só existe atrás do Access (produção). */
export const URL_SAIR = "/cdn-cgi/access/logout";

/**
 * Inicial e e-mail do assessor na barra, com o link "Sair" quando `sair` é verdadeiro.
 * Em tela estreita só a inicial fica visível; o e-mail segue disponível para leitores de tela.
 */
export function UsuarioSessao({ email, sair }: { email: string; sair: boolean }) {
  const inicial = (email.trim()[0] ?? "?").toUpperCase();
  return (
    <Flex align="center" gap="2" minW="0" flexShrink={1}>
      <VisuallyHidden>Conectado como {email}</VisuallyHidden>
      <Box aria-hidden flexShrink={0} w="7" h="7" rounded="full" bg="profundo" color="neve" display="flex" alignItems="center" justifyContent="center" fontSize="xs" fontWeight="semibold" title={email}>
        {inicial}
      </Box>
      <Text aria-hidden fontSize="xs" color="profundo" truncate maxW="44" display={{ base: "none", sm: "block" }}>{email}</Text>
      {sair && (
        <Link href={URL_SAIR} fontSize="xs" color="profundo" flexShrink={0} px="1" rounded="sm" textDecoration="underline" _hover={{ color: "floresta" }}>
          Sair
        </Link>
      )}
    </Flex>
  );
}
