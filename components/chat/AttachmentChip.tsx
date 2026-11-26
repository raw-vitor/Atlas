"use client";
import { Flex, IconButton, Text } from "@chakra-ui/react";
import { LuFileText, LuX } from "react-icons/lu";

export function AttachmentChip({ nome, onRemover }: { nome: string; onRemover?: () => void }) {
  return (
    <Flex align="center" gap="2" bg="areia" borderWidth="1px" borderColor="nevoa" rounded="lg" px="2.5" py="1.5" maxW="240px">
      <LuFileText color="#004031" />
      <Text fontSize="sm" truncate title={nome}>{nome}</Text>
      {onRemover && (
        <IconButton aria-label={`Remover ${nome}`} size="2xs" variant="ghost" onClick={onRemover}><LuX /></IconButton>
      )}
    </Flex>
  );
}
