"use client";
import { Box, chakra, Flex, Text, VisuallyHidden } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import type { Categoria, InfoCategoria } from "@/lib/prompt-tipos";

interface Props {
  categorias: InfoCategoria[];
  ativa: Categoria;
  /** Alterações não salvas por categoria. */
  mudancas: Record<Categoria, number>;
  /** Categorias com erro de validação. */
  comErro: ReadonlySet<Categoria>;
  onSelecionar: (c: Categoria) => void;
}

const rotuloMudancas = (n: number) => `${n} ${n === 1 ? "alteração não salva" : "alterações não salvas"}`;

/**
 * Categorias da página. De md para cima, lista vertical à esquerda; no celular, abas roláveis no topo.
 * Quem tem mudança não salva mostra um ponto; o texto "N alterações" fica para leitores de tela.
 */
export function CategoriaNav({ categorias, ativa, mudancas, comErro, onSelecionar }: Props) {
  const ativoRef = useRef<HTMLButtonElement>(null);
  // No celular, a aba escolhida (ou voltada ao carregar) entra na área visível sem mexer na rolagem da página.
  useEffect(() => {
    const el = ativoRef.current;
    const pai = el?.parentElement;
    if (!el || !pai || pai.scrollWidth <= pai.clientWidth) return;
    pai.scrollTo({ left: el.offsetLeft - (pai.clientWidth - el.offsetWidth) / 2, behavior: "smooth" });
  }, [ativa]);

  return (
    <Box as="nav" aria-label="Categorias de instruções">
      <Text display={{ base: "none", md: "block" }} fontSize="xs" fontWeight="bold" letterSpacing="wider" color="profundo" px="3" mb="2">ETAPAS DO DECK</Text>
      <Flex direction={{ base: "row", md: "column" }} gap="1" overflowX={{ base: "auto", md: "visible" }} pb={{ base: "2", md: "0" }}
        css={{ scrollbarWidth: "thin" }}>
        {categorias.map((c) => {
          const sel = c.id === ativa;
          const n = mudancas[c.id] ?? 0;
          return (
            <chakra.button key={c.id} type="button" ref={sel ? ativoRef : undefined} aria-current={sel ? "page" : undefined}
              flexShrink={0} display="flex" alignItems="center" gap="2" textAlign="left" fontSize="sm" rounded="md" px="3" py="2" whiteSpace="nowrap"
              color={sel ? "floresta" : "profundo"} fontWeight={sel ? "semibold" : "normal"} bg={sel ? "nevoa" : "transparent"}
              borderWidth={{ base: "1px", md: "0" }} borderColor={sel ? "eqi" : "nevoa"} borderLeftWidth={{ md: "3px" }} borderLeftStyle="solid"
              css={{ borderLeftColor: sel ? "var(--chakra-colors-eqi)" : "transparent" }}
              _hover={{ bg: sel ? "nevoa" : "areia" }} _focusVisible={{ outline: "2px solid", outlineColor: "eqi", outlineOffset: "1px" }}
              onClick={() => onSelecionar(c.id)}>
              <Box as="span" flex="1" minW="0">{c.titulo}</Box>
              {n > 0 && (
                <>
                  <Box as="span" aria-hidden display="inline-flex" alignItems="center" gap="1" fontSize="xs" color="eqi" fontWeight="semibold">
                    <Box as="span" display="inline-block" w="8px" h="8px" rounded="full" bg="eqi" />{n}
                  </Box>
                  <VisuallyHidden>{rotuloMudancas(n)}</VisuallyHidden>
                </>
              )}
              {comErro.has(c.id) && (
                <>
                  <Box as="span" aria-hidden fontWeight="bold" color="profundo" fontSize="xs">!</Box>
                  <VisuallyHidden>com erro para corrigir</VisuallyHidden>
                </>
              )}
            </chakra.button>
          );
        })}
      </Flex>
      {Object.values(mudancas).some((n) => n > 0) && (
        <Text display={{ base: "none", md: "flex" }} alignItems="center" gap="1.5" fontSize="xs" color="profundo" px="3" mt="3" aria-hidden>
          <Box as="span" display="inline-block" w="8px" h="8px" rounded="full" bg="eqi" /> tem mudança não salva
        </Text>
      )}
    </Box>
  );
}
