"use client";
import { Box, Flex, ProgressCircle, Text } from "@chakra-ui/react";
import { Tooltip } from "@/components/ui/tooltip";
import { descreverContexto, nivelDe, pctDe } from "./contexto";
import type { Contexto } from "./types";

/** Largura fixa: o anel e o número entram e saem sem deslocar o campo de texto. */
const LARGURA = "46px";

export function ContextoMedidor({ tokens, limite, estimado, partes }: { tokens?: number; limite?: number; estimado?: boolean; partes?: Contexto["partes"] }) {
  if (tokens == null || limite == null || !(limite > 0)) return <Box w={LARGURA} flexShrink={0} aria-hidden />;
  const pct = pctDe(tokens, limite);
  const nivel = nivelDe(pct);
  const linhas = descreverContexto(tokens, limite, estimado, partes);
  const rotulo = `Contexto da conversa em ${pct}%${estimado ? " (estimado)" : ""}`;
  return (
    <Tooltip content={<Box>{linhas.map((l, i) => <Text key={i} fontSize="xs" opacity={i === 0 ? 1 : 0.85}>{l}</Text>)}</Box>}
      positioning={{ placement: "top" }} openDelay={150} closeDelay={0}
      contentProps={{ css: { "--tooltip-bg": "colors.profundo" }, color: "neve", px: "3", py: "2", rounded: "md", borderWidth: "1px", borderColor: "menta" }}>
      <Flex w={LARGURA} h="10" flexShrink={0} align="center" justify="flex-end" gap="1.5" tabIndex={0} role="img" aria-label={rotulo}
        rounded="md" cursor="default" _focusVisible={{ outline: "2px solid", outlineColor: "eqi", outlineOffset: "1px" }}>
        {pct >= 60 && <Text fontSize="xs" color="profundo" fontVariantNumeric="tabular-nums" aria-hidden>{pct}%</Text>}
        <ProgressCircle.Root size="xs" value={pct} aria-hidden>
          <ProgressCircle.Circle css={{ "--size": "16px", "--thickness": "2.5px" }}>
            <ProgressCircle.Track stroke="contexto.trilha" />
            <ProgressCircle.Range stroke={`contexto.${nivel}`} strokeLinecap="round" />
          </ProgressCircle.Circle>
        </ProgressCircle.Root>
      </Flex>
    </Tooltip>
  );
}
