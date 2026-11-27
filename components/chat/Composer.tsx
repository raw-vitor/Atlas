"use client";
import { Box, Flex, IconButton, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LuArrowUp, LuPaperclip, LuSquare } from "react-icons/lu";
import { ACCEPT, EXT_OK, MAX_ARQUIVOS, MAX_ARQUIVO_MB_PADRAO, extensaoDe } from "@/lib/formatos";
import { AttachmentChip } from "./AttachmentChip";


export function Composer({ texto, setTexto, arquivos, setArquivos, onEnviar, onCancelar, desabilitado, cancelando = false, medidor, alerta, foco }: {
  texto: string; setTexto: (s: string) => void; arquivos: File[]; setArquivos: (f: File[]) => void;
  onEnviar: () => void; onCancelar: () => void; desabilitado: boolean;
  /** Cancelamento já pedido: o botão mostra que está cancelando e não aceita outro clique. */
  cancelando?: boolean;
  /** Medidor de contexto, ao lado do botão de enviar. */
  medidor?: ReactNode;
  /** Faixa de alerta acima do campo. */
  alerta?: ReactNode;
  /** Muda para levar o foco ao campo de texto (ex.: ao abrir uma conversa nova). */
  foco?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (foco) campo.current?.focus(); }, [foco]);
  const [recusas, setRecusas] = useState<string[]>([]);
  const adicionar = (novos: File[]) => {
    const aceitos = [...arquivos], r: string[] = [];
    for (const f of novos) {
      const ext = extensaoDe(f.name);
      if (!EXT_OK.includes(ext)) r.push(`${f.name}: formato ${ext || "sem extensão"} não suportado`);
      else if (f.size > MAX_ARQUIVO_MB_PADRAO * 1024 * 1024) r.push(`${f.name}: passa de ${MAX_ARQUIVO_MB_PADRAO} MB`);
      else if (aceitos.some((a) => a.name === f.name && a.size === f.size && a.lastModified === f.lastModified)) r.push(`${f.name}: já anexado`);
      else if (aceitos.length >= MAX_ARQUIVOS) r.push(`${f.name}: limite de ${MAX_ARQUIVOS} arquivos`);
      else aceitos.push(f);
    }
    setRecusas(r);
    setArquivos(aceitos);
  };
  const podeEnviar = !desabilitado && (texto.trim().length > 0 || arquivos.length > 0);
  return (
    <>
    {alerta}
    <Box w="full" maxW="820px" mx="auto" px="4" pb="4">
      <Box bg="white" borderWidth="1px" borderColor="nevoa" rounded="2xl" shadow="sm" p="2" _focusWithin={{ borderColor: "eqi" }}>
        {arquivos.length > 0 && (
          <Flex gap="2" wrap="wrap" p="1" pb="2">
            {arquivos.map((f, i) => (
              <AttachmentChip key={f.name + i} nome={f.name} onRemover={() => setArquivos(arquivos.filter((_, j) => j !== i))} />
            ))}
          </Flex>
        )}
        {recusas.length > 0 && <Text fontSize="xs" color="red.600" px="2" pb="2">Não anexei: {recusas.join("; ")}.</Text>}
        <Flex align="flex-end" gap="1">
          <input ref={input} type="file" multiple accept={ACCEPT} hidden
            onChange={(e) => { adicionar(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <IconButton aria-label="Anexar arquivos" variant="ghost" onClick={() => input.current?.click()}><LuPaperclip /></IconButton>
          <Textarea
            ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: R2 do Elisandro, 13/11"
            autoresize maxH="10lh" rows={1} css={{ "&::placeholder": { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }} border="none" outline="none" resize="none" _focusVisible={{ outline: "none", boxShadow: "none" }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (podeEnviar) onEnviar(); } }}
          />
          {medidor}
          {desabilitado ? (
            <IconButton aria-label={cancelando ? "Cancelando…" : "Cancelar"} rounded="full" bg="profundo" color="neve" _hover={{ bg: "floresta" }}
              loading={cancelando} onClick={onCancelar}>
              <LuSquare />
            </IconButton>
          ) : (
            <IconButton aria-label="Enviar" rounded="full" bg="profundo" color="neve" _hover={{ bg: "floresta" }} disabled={!podeEnviar} onClick={onEnviar}>
              <LuArrowUp />
            </IconButton>
          )}
        </Flex>
      </Box>
    </Box>
    </>
  );
}
