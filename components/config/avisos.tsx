"use client";
import { Portal, Stack, Toast, Toaster as ChakraToaster, createToaster } from "@chakra-ui/react";

/**
 * Avisos da página de configuração (Desfazer). Fica acima da barra de salvar (offset de baixo) e usa as cores da marca,
 * para nunca cobrir o botão "Salvar".
 */
export const avisos = createToaster({
  placement: "bottom-start",
  pauseOnPageIdle: true,
  offsets: { left: "16px", right: "16px", bottom: "84px", top: "16px" },
});

const DURACAO_DESFAZER = 8000;

export function avisarComDesfazer(titulo: string, aoDesfazer: () => void) {
  avisos.create({ title: titulo, type: "info", duration: DURACAO_DESFAZER, closable: true, action: { label: "Desfazer", onClick: aoDesfazer } });
}

export function avisar(titulo: string, descricao?: string) {
  avisos.create({ title: titulo, description: descricao, type: "info", duration: 4000, closable: true });
}

export function Avisos() {
  return (
    <Portal>
      <ChakraToaster toaster={avisos} insetInline={{ mdDown: "4" }}>
        {(t) => (
          <Toast.Root width={{ md: "sm" }} bg="profundo" color="neve" rounded="lg">
            <Stack gap="0.5" flex="1" maxWidth="100%">
              {t.title && <Toast.Title fontWeight="medium">{t.title}</Toast.Title>}
              {t.description && <Toast.Description opacity={0.85}>{t.description}</Toast.Description>}
            </Stack>
            {t.action && <Toast.ActionTrigger color="menta" fontWeight="semibold" _hover={{ color: "neve" }}>{t.action.label}</Toast.ActionTrigger>}
            {t.closable && <Toast.CloseTrigger color="neve" aria-label="Fechar aviso" />}
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  );
}
