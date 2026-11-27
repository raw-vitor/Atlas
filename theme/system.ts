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
        // Medidor de contexto (plano, seção 7.2). Só as cores da marca (10_padrao_visual_eqi.md proíbe amarelo e vermelho):
        // a urgência sobe escurecendo o verde; alertas usam card Areia com "ATENÇÃO" e o crítico, card Floresta com texto Neve.
        "contexto.trilha": { value: "{colors.nevoa}" },
        "contexto.ok": { value: "{colors.menta}" },
        "contexto.atencao": { value: "{colors.eqi}" },
        "contexto.alerta": { value: "{colors.profundo}" },
        "contexto.critico": { value: "{colors.floresta}" },
        "contexto.alerta.bg": { value: "{colors.areia}" },
        "contexto.critico.bg": { value: "{colors.floresta}" },
        "contexto.critico.fg": { value: "{colors.neve}" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
