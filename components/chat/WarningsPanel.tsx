"use client";
import { Box, Heading, List } from "@chakra-ui/react";

export function WarningsPanel({ titulo, itens, destaque }: { titulo: string; itens: string[]; destaque?: boolean }) {
  if (!itens.length) return null;
  return (
    <Box bg={destaque ? "areia" : "neve"} borderWidth="1px" borderColor="nevoa" rounded="lg" p="3">
      <Heading as="h4" size="xs" mb="2" color="floresta">{titulo}</Heading>
      <List.Root fontSize="sm" ps="4" gap="1">
        {itens.map((t, i) => <List.Item key={i}>{t}</List.Item>)}
      </List.Root>
    </Box>
  );
}
