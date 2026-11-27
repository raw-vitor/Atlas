"use client";
import { Box, Button, Flex, Input, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useId, useRef, useState } from "react";
import { LuCircleAlert, LuPlus } from "react-icons/lu";
import { LIMITES, type Categoria } from "@/lib/prompt-tipos";
import { erroDoTexto } from "./estado";

/** Quem usa passa `key={categoria}`: trocar de categoria descarta o rascunho (cada categoria tem o seu espaço). */

/** Sugestões por categoria: um clique preenche o texto, que o assessor pode ajustar. */
export const SUGESTOES: Record<Categoria, { rotulo: string; texto: string }[]> = {
  geral: [
    { rotulo: "Tom mais formal", texto: "Use um tom mais formal e evite expressões coloquiais." },
    { rotulo: "Evitar termos em inglês", texto: "Evite termos em inglês. Quando não houver tradução comum, explique o termo em uma frase simples." },
    { rotulo: "Frases curtas", texto: "Prefira frases curtas, com uma ideia por frase." },
  ],
  carteira: [
    { rotulo: "Comentar a previdência", texto: "Sempre comente a previdência do lead, mesmo quando for uma parte pequena da carteira." },
    { rotulo: "Destacar maiores posições", texto: "Destaque as três maiores posições da carteira na leitura." },
  ],
  lead: [
    { rotulo: "Priorizar o objetivo", texto: "Priorize o objetivo financeiro que o lead repetiu mais de uma vez na conversa." },
    { rotulo: "Registrar preocupações", texto: "Registre as preocupações do lead com as palavras dele, sem suavizar." },
  ],
  proposta: [
    { rotulo: "Proposta mais gradual", texto: "Prefira uma transição gradual, em mais fases, em vez de mudar muita coisa de uma vez." },
    { rotulo: "Justificar cada mudança", texto: "Justifique cada mudança de alocação com uma frase ligada ao que o lead disse." },
  ],
  diagnostico: [
    { rotulo: "Riscos em linguagem simples", texto: "Explique cada risco em linguagem simples, como se falasse com quem nunca investiu em renda variável." },
    { rotulo: "Ligar ao que o lead disse", texto: "Sempre que possível, ligue o diagnóstico a uma fala do lead." },
  ],
  decisao: [
    { rotulo: "Fechar com um próximo passo", texto: "Termine a decisão com um próximo passo concreto e uma data sugerida." },
    { rotulo: "Resumo mais direto", texto: "Deixe o resumo mais direto, com o essencial em cada item." },
  ],
  notas: [
    { rotulo: "Notas mais enxutas", texto: "Mantenha as notas do apresentador mais enxutas, com no máximo dois pontos para falar por slide." },
    { rotulo: "Mais perguntas ao lead", texto: "Inclua pelo menos uma pergunta aberta para o lead em cada slide." },
  ],
};

interface Props {
  categoria: Categoria;
  tituloCategoria: string;
  limiteAtingido: boolean;
  /** Quantos caracteres ainda cabem na soma da etapa. */
  restante: number;
  aoAdicionar: (titulo: string, texto: string) => void;
}

/**
 * "Adicionar instrução nesta etapa": começa como um botão tracejado, do tamanho de um card, e abre no lugar.
 * Cancelar não deixa rastro; "Adicionar" cria o bloco no fim da lista.
 */
export function NovoBloco({ categoria, tituloCategoria, limiteAtingido, restante, aoAdicionar }: Props) {
  const uid = useId();
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [tocou, setTocou] = useState(false);
  const campoTitulo = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const cartao = useRef<HTMLDivElement>(null);

  // O card inteiro (com as sugestões) precisa ficar acima da barra de salvar, que é fixa no rodapé.
  useEffect(() => {
    if (!aberto) return;
    campoTitulo.current?.focus({ preventScroll: true });
    cartao.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [aberto]);
  useEffect(() => {
    const a = area.current;
    if (!aberto || !a) return;
    a.style.height = "auto";
    a.style.height = `${a.scrollHeight + 2}px`;
  }, [texto, aberto]);

  const erro = erroDoTexto(texto, false);
  const mostrarErro = tocou || texto.length > LIMITES.textoBloco ? erro : null;
  const excede = texto.trim().length > restante;

  const fechar = () => { setAberto(false); setTitulo(""); setTexto(""); setTocou(false); requestAnimationFrame(() => botao.current?.focus()); };
  const adicionar = () => {
    setTocou(true);
    if (erro) { area.current?.focus(); return; }
    aoAdicionar(titulo.trim(), texto);
    setAberto(false); setTitulo(""); setTexto(""); setTocou(false);
  };

  if (!aberto) {
    return (
      <Box>
        <Button ref={botao} w="full" h="auto" py="4" variant="outline" borderStyle="dashed" borderColor="profundo" color="profundo" bg="transparent"
          _hover={{ bg: "areia" }} disabled={limiteAtingido} onClick={() => setAberto(true)}>
          <LuPlus /> Adicionar instrução {categoria === "geral" ? "geral" : "nesta etapa"}
        </Button>
        {limiteAtingido && <Text mt="1.5" fontSize="xs" color="profundo">Você chegou ao limite de {LIMITES.extras} instruções próprias. Apague uma para adicionar outra.</Text>}
      </Box>
    );
  }

  return (
    <Box ref={cartao} as="section" role="region" aria-label={`Nova instrução em ${tituloCategoria}`} css={{ scrollMarginBottom: "120px" }} bg="areia" borderWidth="1px" borderColor="eqi" rounded="lg" p="3"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); fechar(); } }}>
      <Text fontSize="sm" fontWeight="semibold" color="profundo" mb="2">Nova instrução</Text>
      <Input ref={campoTitulo} size="sm" bg="neve" borderColor="nevoa" _focusVisible={{ borderColor: "eqi", outline: "none" }} maxLength={LIMITES.tituloBloco}
        placeholder="Título (opcional)" aria-label="Título da nova instrução" value={titulo} onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); area.current?.focus(); } }} />
      <Textarea ref={area} mt="2" value={texto} rows={4} minH="28" resize="none" overflow="hidden" fontSize="sm" lineHeight="1.55" bg="neve"
        borderColor={mostrarErro ? "profundo" : "nevoa"} _focusVisible={{ borderColor: "eqi", outline: "none", boxShadow: "0 0 0 1px {colors.eqi}" }}
        placeholder="Escreva a instrução como se estivesse orientando um analista." aria-label="Texto da nova instrução"
        aria-invalid={mostrarErro ? true : undefined} aria-describedby={`${uid}-e ${uid}-c`}
        onChange={(e) => setTexto(e.target.value)} onBlur={() => { if (texto) setTocou(true); }} />
      <Flex mt="1.5" gap="3" justify="space-between" align="flex-start">
        <Text id={`${uid}-e`} role={mostrarErro ? "alert" : undefined} fontSize="xs" color="profundo" fontWeight="medium" display="flex" gap="1.5" alignItems="flex-start" minH="4">
          {mostrarErro && <><Box as="span" mt="0.5" flexShrink={0}><LuCircleAlert aria-hidden /></Box><span>{mostrarErro}</span></>}
          {!mostrarErro && excede && <span>Com este texto, a soma das suas instruções passa do limite desta etapa.</span>}
        </Text>
        <Text id={`${uid}-c`} fontSize="xs" color="profundo" fontVariantNumeric="tabular-nums" flexShrink={0}>
          {texto.length.toLocaleString("pt-BR")} / {LIMITES.textoBloco.toLocaleString("pt-BR")}
        </Text>
      </Flex>

      <Box mt="2">
        <Text id={`${uid}-s`} fontSize="xs" color="profundo" mb="1.5">Ideias para começar</Text>
        <Flex gap="1.5" wrap="wrap" role="group" aria-labelledby={`${uid}-s`}>
          {SUGESTOES[categoria].map((s) => (
            <Button key={s.rotulo} size="xs" variant="outline" borderColor="nevoa" color="floresta" bg="neve" fontWeight="normal" _hover={{ borderColor: "eqi" }}
              onClick={() => { setTexto((t) => (t.trim() ? `${t.trimEnd()}\n${s.texto}` : s.texto)); setTocou(false); requestAnimationFrame(() => area.current?.focus()); }}>{s.rotulo}</Button>
          ))}
        </Flex>
      </Box>

      <Flex mt="3" gap="2" justify="flex-end">
        <Button size="sm" variant="ghost" color="profundo" onClick={fechar}>Cancelar</Button>
        <Button size="sm" bg="profundo" color="neve" _hover={{ bg: "floresta" }} onClick={adicionar}>Adicionar</Button>
      </Flex>
    </Box>
  );
}
