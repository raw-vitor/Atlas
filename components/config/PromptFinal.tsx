"use client";
import { Box, chakra, CloseButton, Drawer, Flex, NativeSelect, Portal, Text } from "@chakra-ui/react";
import { useId, useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuInfo } from "react-icons/lu";
import { CATEGORIA_DA_ETAPA, ETAPAS, type Categoria, type DadosConfig, type Etapa, type RespostaConfig } from "@/lib/prompt-tipos";
import { etapasDaCategoria, montarPrevia, ROTULO_ETAPA, type Segmento } from "./estado";

interface Props {
  aberta: boolean;
  onFechar: () => void;
  resp: Pick<RespostaConfig, "categorias" | "tamanhoKb">;
  dados: DadosConfig;
  /** Categoria aberta na página: a gaveta abre na primeira etapa dela. */
  categoriaAtual: Categoria;
  /** O rascunho tem mudanças que ainda não foram salvas (a prévia já as mostra). */
  naoSalvo: boolean;
}

function Trecho({ s }: { s: Segmento }) {
  const [aberta, setAberta] = useState(false);
  if (s.tipo === "assessor") return <Box as="mark" bg="menta/35" color="floresta" rounded="sm" px="0.5" css={{ boxDecorationBreak: "clone" }}>{s.texto}</Box>;
  if (s.tipo === "extras") return <Text as="span" fontWeight="bold" color="profundo">{s.texto}</Text>;
  if (s.tipo === "referencia") {
    return (
      <Box as="span" display="block" my="2" fontFamily="body">
        <chakra.button type="button" aria-expanded={aberta} onClick={() => setAberta((v) => !v)} display="inline-flex" alignItems="center" gap="1.5" textAlign="left"
          bg="nevoa" color="profundo" rounded="md" px="2" py="1" fontSize="xs" _hover={{ bg: "areia" }} _focusVisible={{ outline: "2px solid", outlineColor: "eqi" }}>
          {aberta ? <LuChevronDown aria-hidden /> : <LuChevronRight aria-hidden />}
          {s.texto}
        </chakra.button>
        {aberta && (
          <Box as="ul" mt="1.5" ml="6" fontSize="xs" color="profundo" listStyleType="disc">
            {(s.itens ?? []).map((i) => <li key={i}>{i}</li>)}
            <Text as="li" listStyleType="none" ml="-4" mt="1" fontStyle="italic">O texto da base de conhecimento entra aqui e não é editável.</Text>
          </Box>
        )}
      </Box>
    );
  }
  return <>{s.texto}</>;
}

/**
 * Gaveta "Ver prompt final": o system prompt da etapa como o Atlas o monta, com as suas mudanças em menta.
 * A montagem é `montarPrevia` (estado.ts), que usa `montarSistemaResumo` de lib/prompt-blocos.ts.
 */
export function PromptFinal({ aberta, onFechar, ...resto }: Props) {
  return (
    <Drawer.Root open={aberta} onOpenChange={(e) => { if (!e.open) onFechar(); }} placement="end" size={{ base: "full", md: "lg" }} lazyMount unmountOnExit>
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content bg="neve" color="floresta" maxW={{ md: "min(640px, 92vw)" }}>
            {/* Montado só enquanto a gaveta está aberta: a etapa escolhida volta ao padrão a cada abertura. */}
            <Conteudo {...resto} />
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}

function Conteudo({ resp, dados, categoriaAtual, naoSalvo }: Omit<Props, "aberta" | "onFechar">) {
  const uid = useId();
  const [etapa, setEtapa] = useState<Etapa>(etapasDaCategoria(categoriaAtual)[0] ?? "lead");
  const previa = useMemo(() => montarPrevia(etapa, resp, dados), [etapa, resp, dados]);
  const info = resp.categorias.find((c) => c.id === CATEGORIA_DA_ETAPA[etapa]);
  const temAssessor = previa.segmentos.some((s) => s.tipo === "assessor");

  return (
    <>
            <Drawer.Header borderBottomWidth="1px" borderColor="nevoa" pb="3" display="block">
              <Flex justify="space-between" align="flex-start" gap="3">
                <Box>
                  <Drawer.Title color="profundo">Texto final</Drawer.Title>
                  <Drawer.Description fontSize="sm" color="profundo" mt="0.5">É o texto completo que o Atlas segue nesta etapa, com o Método e as regras. Suas mudanças aparecem em verde.</Drawer.Description>
                </Box>
                <Drawer.CloseTrigger asChild position="static"><CloseButton size="sm" aria-label="Fechar o texto final" /></Drawer.CloseTrigger>
              </Flex>
              <Box mt="3">
                <chakra.label htmlFor={`${uid}-etapa`} fontSize="xs" fontWeight="semibold" color="profundo" display="block" mb="1">Etapa</chakra.label>
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field id={`${uid}-etapa`} value={etapa} bg="areia" borderColor="nevoa" onChange={(e) => setEtapa(e.target.value as Etapa)}>
                    {ETAPAS.map((e) => <option key={e} value={e}>{ROTULO_ETAPA[e]}</option>)}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Box>
            </Drawer.Header>
            <Drawer.Body py="4">
              {naoSalvo && (
                <Flex gap="2" align="flex-start" fontSize="xs" color="profundo" mb="3"><Box mt="0.5" flexShrink={0}><LuInfo aria-hidden /></Box><Text>Inclui mudanças que você ainda não salvou.</Text></Flex>
              )}
              {previa.avisoEtapas && (
                <Flex gap="2" align="flex-start" fontSize="xs" color="profundo" bg="areia" borderWidth="1px" borderColor="nevoa" rounded="md" p="2" mb="3">
                  <Box mt="0.5" flexShrink={0}><LuInfo aria-hidden /></Box><Text>{previa.avisoEtapas}</Text>
                </Flex>
              )}
              <Box role="region" aria-label={`Texto final: ${ROTULO_ETAPA[etapa]}`} tabIndex={0} bg="areia" borderWidth="1px" borderColor="nevoa" rounded="lg" p="4"
                fontFamily="mono" fontSize="xs" lineHeight="1.7" whiteSpace="pre-wrap" overflowWrap="anywhere" _focusVisible={{ outline: "2px solid", outlineColor: "eqi" }}>
                {previa.segmentos.map((s, i) => <Trecho key={i} s={s} />)}
              </Box>
              <Text mt="3" fontSize="xs" color="profundo">
                {temAssessor ? "Em verde: trechos que você editou e instruções suas." : "Nenhuma mudança sua entra nesta etapa."}
                {info ? ` Etapa afeta: ${info.slides.join(", ")}.` : ""}
              </Text>
            </Drawer.Body>
    </>
  );
}
