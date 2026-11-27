import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

// Paleta EQI (conhecimento/10_padrao_visual_eqi.md)
const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        neve: { value: "#FFFAFA" },
        areia: { value: "#F2EDED" },
        nevoa: { value: "#D9E3E0" },
        menta: { value: "#63C6A5" },
        eqi: { value: "#009E76" },
        profundo: { value: "#004031" },
        floresta: { value: "#00291E" },
      },
      fonts: {
        body: { value: "var(--font-geist-sans), system-ui, sans-serif" },
        heading: { value: "var(--font-geist-sans), system-ui, sans-serif" },
      },
    },
    semanticTokens: {
      colors: {
        "bg.canvas": { value: "{colors.neve}" },
        "fg.texto": { value: "{colors.floresta}" },
        // Medidor de contexto (plano, seção 7.2). Tons discretos, fora da paleta EQI, pedidos para o alerta.
        "contexto.ok": { value: "{colors.eqi}" },
        "contexto.atencao": { value: "{colors.yellow.400}" },
        "contexto.alerta": { value: "{colors.orange.500}" },
        "contexto.critico": { value: "{colors.red.600}" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
