"use client";
import { Badge, Box, chakra, Button, Flex, Grid, Heading, IconButton, Input, Menu, Portal, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import {
  LuArrowDown, LuArrowUp, LuCircleAlert, LuCopy, LuEllipsis, LuEye, LuGripVertical, LuInfo, LuLock, LuPencil, LuPower, LuPowerOff, LuRotateCcw, LuTrash2, LuType,
} from "react-icons/lu";
import { LIMITES } from "@/lib/prompt-tipos";
import { diffPalavras, estaAlterado, type ItemBloco, type Selo } from "./estado";

const ROTULO: Record<Selo, string> = { original: "Original", editado: "Editado", desligado: "Desligado", proprio: "Seu bloco", travado: "Travado" };

/** Selo de estado. O texto sempre aparece: a cor nunca é a única pista. */
function SeloBloco({ selo }: { selo: Selo }) {
  const estilos: Record<Selo, object> = {
    original: { bg: "transparent", color: "profundo", borderWidth: "1px", borderColor: "nevoa" },
    editado: { bg: "eqi", color: "neve" },
    desligado: { bg: "nevoa", color: "profundo" },
    proprio: { bg: "menta", color: "floresta" },
    travado: { bg: "profundo", color: "neve" },
  };
  return (
    <Badge size="sm" variant="solid" fontWeight="medium" flexShrink={0} {...estilos[selo]}>
      {selo === "travado" && <LuLock aria-hidden />}
      {selo === "desligado" && <LuPowerOff aria-hidden />}
      {ROTULO[selo]}
    </Badge>
  );
}

export interface ArrastoCard {
  /** Mostra a linha de destino acima ou abaixo deste card. */
  indicador: "antes" | "depois" | null;
  arrastando: boolean;
  /** Este é o card que está sendo arrastado. */
  origem: boolean;
  onInicio: () => void;
  onSobre: (depois: boolean) => void;
  onSoltar: () => void;
  onFim: () => void;
}

export interface BlocoCardProps {
  item: ItemBloco;
  erro?: string | null;
  podeSubir?: boolean;
  podeDescer?: boolean;
  podeDuplicar?: boolean;
  arrasto?: ArrastoCard;
  onTexto: (texto: string) => void;
  onTitulo: (titulo: string) => void;
  onAtivo: (ativo: boolean) => void;
  onRestaurar: () => void;
  onDuplicar: () => void;
  onApagar: () => void;
  onMover: (delta: -1 | 1) => void;
  onManterVersao: () => void;
}

type Modo = "fechado" | "texto" | "titulo";

/**
 * Card de um bloco. Fechado: título, selos e prévia de 2 linhas. Aberto: edição no próprio card (sem modal),
 * com a textarea crescendo junto do texto. Blocos travados só abrem para leitura.
 */
export function BlocoCard(p: BlocoCardProps) {
  const { item } = p;
  const uid = useId();
  const idTitulo = `${uid}-t`, idErro = `${uid}-e`, idTexto = `${uid}-x`;
  const [modo, setModo] = useState<Modo>("fechado");
  const [lendo, setLendo] = useState(false);   // travado: texto completo
  const [comparando, setComparando] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const titulo = useRef<HTMLInputElement>(null);
  const cartao = useRef<HTMLDivElement>(null);
  const extra = item.tipo === "extra";
  const editando = modo !== "fechado";

  // Entrando na edição, o foco vai para o campo e o cursor para o fim do texto.
  // Ao escolher "Editar" ou "Renomear" no menu, o menu devolve o foco ao botão "⋯" logo depois de fechar; por isso o foco é reaplicado após esse retorno.
  useEffect(() => {
    const focar = () => {
      if (modo === "texto" && area.current) { const a = area.current; a.focus(); a.setSelectionRange(a.value.length, a.value.length); }
      if (modo === "titulo") titulo.current?.select();
    };
    focar();
    if (modo === "fechado") return;
    const t = window.setTimeout(() => { if (!cartao.current?.contains(document.activeElement) || document.activeElement?.tagName === "BUTTON") focar(); }, 80);
    return () => window.clearTimeout(t);
  }, [modo]);

  // A textarea cresce com o conteúdo.
  useEffect(() => {
    const a = area.current;
    if (!editando || !a) return;
    a.style.height = "auto";
    a.style.height = `${a.scrollHeight + 2}px`;
  }, [item.texto, editando]);

  const n = item.texto.length;
  const passou = n > LIMITES.textoBloco;
  const alterado = estaAlterado(item);

  const abrirDe = (m: Modo) => { setComparando(false); setModo(m); };
  const fechar = () => { setModo("fechado"); cartao.current?.focus(); };

  const aoMenu = (v: string) => {
    if (v === "editar") abrirDe("texto");
    else if (v === "renomear") abrirDe("titulo");
    else if (v === "ligar") p.onAtivo(true);
    else if (v === "desligar") p.onAtivo(false);
    else if (v === "restaurar") { setModo("fechado"); setComparando(false); p.onRestaurar(); }
    else if (v === "original") { setModo("fechado"); setComparando((c) => !c); }
    else if (v === "duplicar") p.onDuplicar();
    else if (v === "subir") p.onMover(-1);
    else if (v === "descer") p.onMover(1);
    else if (v === "apagar") p.onApagar();
  };

  const a = p.arrasto;
  const aoArrastar = (e: DragEvent<HTMLDivElement>) => {
    if (!a?.arrastando) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    a.onSobre(e.clientY > r.top + r.height / 2);
  };

  return (
    <Box ref={cartao} id={`bloco-${item.id}`} as="section" role="region" aria-labelledby={idTitulo} tabIndex={-1} outline="none"
      position="relative" bg="areia" borderWidth="1px" rounded="lg" borderColor={p.erro ? "profundo" : editando ? "eqi" : "nevoa"}
      boxShadow={p.erro ? "0 0 0 1px {colors.profundo}" : undefined} transition="border-color 0.15s"
      _focusVisible={{ outline: "2px solid", outlineColor: "eqi", outlineOffset: "2px" }}
      opacity={a?.origem ? 0.5 : 1} css={{ scrollMarginBottom: "120px" }}
      onDragOver={a ? aoArrastar : undefined}
      onDrop={a ? (e) => { e.preventDefault(); a.onSoltar(); } : undefined}>
      {a?.indicador && (
        <Box aria-hidden position="absolute" left="2" right="2" h="2px" rounded="full" bg="eqi" zIndex={1}
          top={a.indicador === "antes" ? "-5px" : undefined} bottom={a.indicador === "depois" ? "-5px" : undefined} />
      )}

      <Flex align="center" gap="2" px="3" pt="3" pb={editando || (!item.ajuda && !item.texto) ? "2" : "1"}>
        {extra && (
          <Box as="span" aria-hidden title="Arraste para reordenar" draggable color="profundo" cursor="grab" flexShrink={0} display="flex" alignItems="center"
            css={{ "@media (hover: none)": { display: "none" } }} _active={{ cursor: "grabbing" }}
            onDragStart={(e: DragEvent<HTMLSpanElement>) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", item.id);
              if (cartao.current) e.dataTransfer.setDragImage(cartao.current, 16, 16);
              a?.onInicio();
            }}
            onDragEnd={() => a?.onFim()}><LuGripVertical /></Box>
        )}
        {modo === "titulo" ? (
          <Input ref={titulo} size="sm" maxW="xs" bg="neve" borderColor="nevoa" _focusVisible={{ borderColor: "eqi", outline: "none" }} value={item.titulo} maxLength={LIMITES.tituloBloco}
            aria-label="Título da instrução" onChange={(e) => p.onTitulo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setModo("texto"); } }} />
        ) : (
          <Heading as="h3" id={idTitulo} size="sm" color="profundo" fontWeight="semibold" minW="0" flex="1" truncate={!editando}>{item.titulo || "Sem título"}</Heading>
        )}
        {modo === "titulo" && <Box flex="1" />}
        <Flex align="center" gap="1.5" flexShrink={0} wrap="wrap" justify="flex-end">
          {item.selos.map((s) => <SeloBloco key={s} selo={s} />)}
        </Flex>
        {alterado && (
          <IconButton size="xs" variant="ghost" color="profundo" aria-label={`Restaurar o original de ${item.titulo}`} title="Restaurar original"
            display={{ base: "none", sm: "inline-flex" }} onClick={() => aoMenu("restaurar")}><LuRotateCcw /></IconButton>
        )}
        {!item.travado && (
          <Menu.Root positioning={{ placement: "bottom-end" }} onSelect={(e) => aoMenu(e.value)}>
            <Menu.Trigger asChild>
              <IconButton size="xs" variant="ghost" color="profundo" aria-label={`Opções do bloco ${item.titulo}`}><LuEllipsis /></IconButton>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="52">
                  <Menu.Item value="editar"><LuPencil /> Editar</Menu.Item>
                  {extra && <Menu.Item value="renomear"><LuType /> Renomear</Menu.Item>}
                  {item.ativo
                    ? <Menu.Item value="desligar"><LuPowerOff /> Desligar</Menu.Item>
                    : <Menu.Item value="ligar"><LuPower /> Ligar</Menu.Item>}
                  {!extra && <Menu.Item value="restaurar" disabled={!alterado}><LuRotateCcw /> Restaurar original</Menu.Item>}
                  {!extra && <Menu.Item value="original"><LuEye /> {comparando ? "Esconder original" : "Ver original"}</Menu.Item>}
                  {extra && <Menu.Item value="duplicar" disabled={!p.podeDuplicar}><LuCopy /> Duplicar</Menu.Item>}
                  {extra && <Menu.Item value="subir" disabled={!p.podeSubir}><LuArrowUp /> Mover para cima</Menu.Item>}
                  {extra && <Menu.Item value="descer" disabled={!p.podeDescer}><LuArrowDown /> Mover para baixo</Menu.Item>}
                  {extra && <Menu.Item value="apagar"><LuTrash2 /> Apagar</Menu.Item>}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        )}
      </Flex>

      {!editando && item.ajuda && <Text px="3" fontSize="xs" color="profundo" opacity={0.8}>{item.ajuda}</Text>}

      {/* Fechado: a prévia é o botão que abre a edição (ou a leitura, nos travados). */}
      {!editando && (
        <Box px="3" pb="3" pt="1.5">
          {item.travado ? (
            <>
              <chakra.button type="button" w="full" textAlign="left" rounded="md" cursor="pointer" aria-expanded={lendo} aria-label={`${lendo ? "Recolher" : "Ler"} o bloco ${item.titulo}`}
                onClick={() => setLendo((v) => !v)} _focusVisible={{ outline: "2px solid", outlineColor: "eqi", outlineOffset: "2px" }}>
                <Text fontSize="sm" whiteSpace={lendo ? "pre-wrap" : undefined} lineClamp={lendo ? undefined : 2}>{item.texto}</Text>
              </chakra.button>
              <Flex align="center" gap="1.5" mt="2" color="profundo" fontSize="xs"><LuLock aria-hidden /> Regra de compliance: só leitura. Não pode ser editada nem desligada.</Flex>
            </>
          ) : (
            <chakra.button type="button" w="full" textAlign="left" rounded="md" cursor="text" aria-label={`Editar o bloco ${item.titulo}`}
              onClick={() => abrirDe("texto")} _focusVisible={{ outline: "2px solid", outlineColor: "eqi", outlineOffset: "2px" }}>
              <Text fontSize="sm" lineClamp={2} opacity={item.ativo ? 1 : 0.55} color={item.texto.trim() ? undefined : "profundo"}>
                {item.texto.trim() ? item.texto : "Sem texto. Clique para escrever."}
              </Text>
            </chakra.button>
          )}
        </Box>
      )}

      {editando && (
        <Box px="3" pb="3">
          <Textarea ref={area} id={idTexto} value={item.texto} rows={4} resize="none" overflow="hidden" fontSize="sm" lineHeight="1.55" bg="neve" borderColor={p.erro ? "profundo" : "nevoa"}
            _focusVisible={{ borderColor: "eqi", outline: "none", boxShadow: "0 0 0 1px {colors.eqi}" }} minH="28" aria-label={`Texto do bloco ${item.titulo}`}
            aria-invalid={p.erro ? true : undefined} aria-describedby={`${idErro} ${idTexto}-c`}
            placeholder={extra ? "Escreva a instrução como se estivesse orientando um analista." : undefined}
            onChange={(e) => p.onTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); fechar(); } }} />
          <Flex mt="1.5" gap="3" align="flex-start" justify="space-between">
            <Text id={idErro} role={p.erro ? "alert" : undefined} fontSize="xs" color="profundo" fontWeight="medium" display="flex" gap="1.5" alignItems="flex-start" minH="4">
              {p.erro && <><Box as="span" mt="0.5" flexShrink={0}><LuCircleAlert aria-hidden /></Box><span>{p.erro}</span></>}
            </Text>
            <Text id={`${idTexto}-c`} fontSize="xs" color={passou || n >= LIMITES.textoBloco * 0.9 ? "contexto.alerta" : "profundo"} fontWeight={passou || n >= LIMITES.textoBloco * 0.9 ? "bold" : "normal"}
              fontVariantNumeric="tabular-nums" flexShrink={0}>
              {n.toLocaleString("pt-BR")} / {LIMITES.textoBloco.toLocaleString("pt-BR")}
            </Text>
          </Flex>
          <Flex mt="2" gap="2" justify="space-between" align="center" wrap="wrap">
            <Text fontSize="xs" color="profundo" opacity={0.75}>Esc para fechar</Text>
            <Flex gap="2">
              {alterado && <Button size="xs" variant="ghost" color="profundo" onClick={() => aoMenu("restaurar")}><LuRotateCcw /> Restaurar original</Button>}
              <Button size="xs" bg="profundo" color="neve" _hover={{ bg: "floresta" }} onClick={fechar}>Concluir</Button>
            </Flex>
          </Flex>
        </Box>
      )}

      {item.originalMudou && (
        <Flex mx="3" mb="3" px="3" py="2" gap="2" align="flex-start" rounded="md" bg="neve" borderWidth="1px" borderColor="nevoa" fontSize="xs" color="floresta" direction={{ base: "column", sm: "row" }}>
          <Flex gap="2" flex="1" align="flex-start"><Box mt="0.5" flexShrink={0}><LuInfo aria-hidden /></Box><Text>O original deste bloco mudou desde a sua edição.</Text></Flex>
          <Flex gap="1" flexShrink={0}>
            <Button size="2xs" variant="outline" borderColor="profundo" color="profundo" onClick={() => { setModo("fechado"); setComparando(true); }}>Ver diferença</Button>
            <Button size="2xs" variant="ghost" color="profundo" onClick={p.onManterVersao}>Manter a minha versão</Button>
          </Flex>
        </Flex>
      )}

      {comparando && item.textoOriginal != null && <Comparacao original={item.textoOriginal} atual={item.texto} editado={item.editado} onFechar={() => setComparando(false)} />}
    </Box>
  );
}

/** Original ao lado da versão do assessor, com as palavras trocadas marcadas. Sem modal, dentro do card. */
function Comparacao({ original, atual, editado, onFechar }: { original: string; atual: string; editado: boolean; onFechar: () => void }) {
  const trechos = editado ? diffPalavras(original, atual) : [];
  const moldura = { bg: "neve", borderWidth: "1px", borderColor: "nevoa", rounded: "md", p: "3", fontSize: "xs", lineHeight: "1.6", whiteSpace: "pre-wrap" as const, maxH: "64", overflowY: "auto" as const };
  return (
    <Box px="3" pb="3">
      <Grid templateColumns={{ base: "1fr", md: editado ? "1fr 1fr" : "1fr" }} gap="2">
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="profundo" mb="1">Original</Text>
          <Box {...moldura} tabIndex={0} aria-label="Texto original">
            {editado
              ? trechos.filter((t) => t.tipo !== "adicionado").map((t, i) => (
                t.tipo === "removido" ? <Box as="mark" key={i} bg="nevoa" color="floresta" textDecoration="line-through" textDecorationColor="profundo">{t.texto}</Box> : <span key={i}>{t.texto}</span>))
              : original}
          </Box>
        </Box>
        {editado && (
          <Box>
            <Text fontSize="xs" fontWeight="semibold" color="profundo" mb="1">Sua versão</Text>
            <Box {...moldura} tabIndex={0} aria-label="Sua versão">
              {trechos.filter((t) => t.tipo !== "removido").map((t, i) => (
                t.tipo === "adicionado" ? <Box as="mark" key={i} bg="menta/35" color="floresta">{t.texto}</Box> : <span key={i}>{t.texto}</span>))}
            </Box>
          </Box>
        )}
      </Grid>
      <Flex justify="space-between" align="center" mt="2" gap="2">
        <Text fontSize="xs" color="profundo">{editado ? "Riscado: saiu do original. Em verde: foi acrescentado por você." : "Este bloco está igual ao original."}</Text>
        <Button size="2xs" variant="ghost" color="profundo" onClick={onFechar}>Fechar</Button>
      </Flex>
    </Box>
  );
}
