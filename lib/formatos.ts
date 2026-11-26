/** Fonte única dos formatos aceitos. Usada pelo Composer (accept) e pelo servidor (validação por extensão). */
export type PalpitePapel = "carteira" | "transcricao" | "ambos";

export const FORMATOS: Record<string, { mime: string; palpite: PalpitePapel }> = {
  ".xlsx": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", palpite: "carteira" },
  ".xls": { mime: "application/vnd.ms-excel", palpite: "carteira" },
  ".csv": { mime: "text/csv", palpite: "carteira" },
  ".pdf": { mime: "application/pdf", palpite: "ambos" },
  ".png": { mime: "image/png", palpite: "carteira" },
  ".jpg": { mime: "image/jpeg", palpite: "carteira" },
  ".jpeg": { mime: "image/jpeg", palpite: "carteira" },
  ".webp": { mime: "image/webp", palpite: "carteira" },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", palpite: "transcricao" },
  ".odt": { mime: "application/vnd.oasis.opendocument.text", palpite: "transcricao" },
  ".vtt": { mime: "text/vtt", palpite: "transcricao" },
  ".txt": { mime: "text/plain", palpite: "transcricao" },
  ".md": { mime: "text/markdown", palpite: "transcricao" },
  ".json": { mime: "application/json", palpite: "ambos" },
  ".pptx": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", palpite: "transcricao" },
};

export const EXT_OK = Object.keys(FORMATOS);
export const ACCEPT = EXT_OK.join(",");

export const MAX_ARQUIVOS = 10;
export const MAX_LOTE_MB = 60;

/** Extensão em minúsculas, com ponto. A validação usa só isto, nunca o MIME enviado pelo navegador. */
export const extensaoDe = (nome: string) => {
  const i = nome.lastIndexOf(".");
  return i < 0 ? "" : nome.slice(i).toLowerCase();
};

export const MAX_ARQUIVO_MB_PADRAO = 25;
