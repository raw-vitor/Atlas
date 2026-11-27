"use client";
import { Box, Button, CloseButton, Dialog, Drawer, Flex, Heading, IconButton, Menu, Portal, Skeleton, Stack, Text, VisuallyHidden } from "@chakra-ui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LuEllipsis, LuPlus, LuTrash2 } from "react-icons/lu";
import { AtlasOrb } from "@/components/atlas/AtlasOrb";
import { pctDe } from "./contexto";
import type { ConversaResumo } from "./types";

export type EstadoLista = "carregando" | "ok" | "erro";

interface Props {
  itens: ConversaResumo[];
  estado: EstadoLista;
  temMais: boolean;
  carregandoMais: boolean;
  erroMais: boolean;
  ativaId: string | null;
  erroApagar: string | null;
  onSelecionar: (id: string) => void;
  onNova: () => void;
  onMais: () => void;
  onTentar: () => void;
  onApagar: (c: ConversaResumo) => void;
}

/** Mostra um ponto só nas conversas com o contexto quase cheio (85% ou mais). */
const pctItem = (c: ConversaResumo) => pctDe(c.ctxTokens, c.ctxLimite);

/** Conteúdo da lista (cabeçalho, itens, paginação e diálogo de apagar). Usado na lateral (md ou mais) e na gaveta (celular). */
function Painel({ itens, estado, temMais, carregandoMais, erroMais, ativaId, erroApagar, onSelecionar, onNova, onMais, onTentar, onApagar, fechar }: Props & { fechar?: ReactNode }) {
  const rolagem = useRef<HTMLDivElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const [paraApagar, setParaApagar] = useState<ConversaResumo | null>(null);
  const [dialogo, setDialogo] = useState(false);
  const cancelar = useRef<HTMLButtonElement>(null);

  // Carrega a próxima página ao chegar ao fim da lista.
  useEffect(() => {
    const alvo = fim.current;
    if (!alvo || !temMais || carregandoMais || erroMais || estado !== "ok") return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) onMais(); }, { root: rolagem.current, rootMargin: "80px" });
    io.observe(alvo);
    return () => io.disconnect();
  }, [temMais, carregandoMais, erroMais, estado, onMais, itens.length]);

  return (
    <>
      <Flex align="center" gap="2"><AtlasOrb tamanho={24} /><Heading size="md" color="profundo" flex="1">Atlas</Heading>{fechar}</Flex>
      <Button onClick={onNova} variant="outline" borderColor="profundo" color="profundo" justifyContent="flex-start"><LuPlus /> Nova conversa</Button>
      <Stack ref={rolagem} gap="1" overflowY="auto" flex="1" minH="0">
        {estado === "carregando" && Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} h="8" rounded="md" aria-hidden css={{ "--start-color": "colors.nevoa", "--end-color": "colors.neve" }} />
        ))}
        {estado === "erro" && (
          <Stack gap="2" align="flex-start" px="1" role="alert">
            <Text fontSize="sm" color="profundo">Não consegui carregar as conversas.</Text>
            <Button size="xs" variant="outline" borderColor="profundo" color="profundo" onClick={onTentar}>Tentar de novo</Button>
          </Stack>
        )}
        {estado === "ok" && itens.length === 0 && <Text fontSize="sm" color="profundo" px="1">Nenhuma conversa ainda.</Text>}
        {estado === "ok" && itens.map((c) => {
          const ativa = c.id === ativaId;
          const pct = pctItem(c);
          return (
            <Flex key={c.id} role="group" align="center" gap="1" rounded="md" _hover={{ bg: ativa ? undefined : "nevoa" }} bg={ativa ? "nevoa" : undefined}>
              <Button flex="1" minW="0" variant="ghost" justifyContent="flex-start" size="sm" onClick={() => onSelecionar(c.id)}
                aria-current={ativa ? "page" : undefined} title={c.titulo} _hover={{ bg: "transparent" }}><Box as="span" truncate minW="0">{c.titulo}</Box></Button>
              {pct >= 85 && (
                <>
                  <Box w="6px" h="6px" rounded="full" flexShrink={0} bg={pct >= 95 ? "contexto.critico" : "contexto.alerta"} aria-hidden />
                  <VisuallyHidden>Contexto em {pct}%</VisuallyHidden>
                </>
              )}
              <Menu.Root positioning={{ placement: "bottom-end" }} onSelect={() => { setParaApagar(c); setDialogo(true); }}>
                <Menu.Trigger asChild>
                  <IconButton aria-label={`Opções da conversa ${c.titulo}`} size="2xs" variant="ghost" flexShrink={0} mr="1" transition="opacity 0.15s"
                    css={{
                      opacity: 0,
                      "[role=group]:hover > &, [role=group]:focus-within > &, &[data-state=open], &:focus-visible": { opacity: 1 },
                      "@media (hover: none)": { opacity: 1 },
                    }}><LuEllipsis /></IconButton>
                </Menu.Trigger>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content minW="44">
                      <Menu.Item value="apagar"><LuTrash2 /> Apagar conversa</Menu.Item>
                    </Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
            </Flex>
          );
        })}
        {estado === "ok" && temMais && (
          <Flex ref={fim} justify="center" align="center" minH="8">
            {carregandoMais && <Text fontSize="xs" color="profundo">Carregando…</Text>}
            {erroMais && <Button size="xs" variant="ghost" color="profundo" onClick={onMais}>Não deu certo. Tentar de novo</Button>}
          </Flex>
        )}
      </Stack>
      {erroApagar && <Text fontSize="xs" color="red.600" role="alert">{erroApagar}</Text>}

      <Dialog.Root role="alertdialog" open={dialogo} onOpenChange={(e) => setDialogo(e.open)} initialFocusEl={() => cancelar.current} placement="center" lazyMount unmountOnExit>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="neve" color="floresta" mx="4">
              <Dialog.Header><Dialog.Title color="profundo">Apagar conversa</Dialog.Title></Dialog.Header>
              <Dialog.Body>
                {paraApagar && <Text fontWeight="medium" truncate mb="2">{paraApagar.titulo}</Text>}
                <Text>Apagar a conversa e os arquivos dela? Não dá para desfazer.</Text>
              </Dialog.Body>
              <Dialog.Footer gap="2">
                <Button ref={cancelar} variant="outline" borderColor="profundo" color="profundo" onClick={() => setDialogo(false)}>Cancelar</Button>
                <Button bg="profundo" color="neve" _hover={{ bg: "floresta" }}
                  onClick={() => { const c = paraApagar; setDialogo(false); if (c) onApagar(c); }}>Apagar</Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
}

/** Lista fixa à esquerda, de md para cima. */
export function ConversaLista(props: Props) {
  return (
    <Flex direction="column" w="260px" bg="areia" borderRightWidth="1px" borderColor="nevoa" p="3" gap="3" display={{ base: "none", md: "flex" }} as="nav" aria-label="Conversas">
      <Painel {...props} />
    </Flex>
  );
}

/** A mesma lista numa gaveta, para telas estreitas. Escolher uma conversa ou criar uma nova fecha a gaveta. */
export function ConversaGaveta({ aberta, onFechar, onSelecionar, onNova, ...resto }: Props & { aberta: boolean; onFechar: () => void }) {
  return (
    <Drawer.Root open={aberta} onOpenChange={(e) => { if (!e.open) onFechar(); }} placement="start" size="xs" lazyMount unmountOnExit>
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content bg="areia" color="floresta" maxW="min(300px, 85vw)">
            <Drawer.Body as="nav" aria-label="Conversas" display="flex" flexDirection="column" gap="3" p="3">
              <Painel {...resto} onSelecionar={(id) => { onSelecionar(id); onFechar(); }} onNova={() => { onNova(); onFechar(); }}
                fechar={<CloseButton size="sm" aria-label="Fechar a lista de conversas" onClick={onFechar} />} />
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}
