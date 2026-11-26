/** Converte qualquer arquivo de entrada em texto. Tudo em memória: nada do lead vai para o disco. */
import path from "node:path";
import { PROMPT_IMAGEM } from "./prompts";
import { transcreverImagem, type Uso } from "./bedrock";

export { EXT_OK } from "./formatos";

async function docx(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  return (await mammoth.extractRawText({ buffer: buf })).value;
}

async function pdf(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(doc, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n");
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function pptx(buf: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .map((n) => ({ n, m: n.match(/^ppt\/slides\/slide(\d+)\.xml$/) }))
    .filter((x) => x.m).sort((a, b) => Number(a.m![1]) - Number(b.m![1]));
  const out: string[] = [];
  for (const [i, s] of slides.entries()) {
    out.push(`--- slide ${i + 1} ---`);
    const xml = await zip.files[s.n].async("string");
    for (const par of xml.split("</a:p>")) {
      const t = [...par.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join("");
      if (t.trim()) out.push(t);
    }
  }
  return out.join("\n");
}

async function odt(buf: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const f = zip.files["content.xml"];
  if (!f) throw new Error("ODT sem content.xml");
  const xml = await f.async("string");
  const out: string[] = [];
  for (const m of xml.matchAll(/<text:(p|h)\b[^>]*>([\s\S]*?)<\/text:\1>/g)) {
    const t = decodeXml(
      m[2].replace(/<text:line-break\s*\/>/g, "\n").replace(/<text:tab\s*\/>/g, "\t")
        .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_x, n) => " ".repeat(Number(n || 1))).replace(/<[^>]+>/g, ""));
    if (t.trim()) out.push(t);
  }
  return out.join("\n");
}

/** WebVTT: tira cabeçalho, números de cue, linhas de tempo e blocos NOTE/STYLE; mantém as falas. */
export function vtt(txt: string): string {
  const out: string[] = [];
  for (const bloco of txt.replace(/^\uFEFF/, "").split(/\r?\n\s*\r?\n/)) {
    const linhas = bloco.split(/\r?\n/).filter((l) => l.trim());
    if (!linhas.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(linhas[0])) continue;
    for (const l of linhas) {
      if (/-->/.test(l) || /^\d+$/.test(l.trim())) continue;
      out.push(l.replace(/<[^>]+>/g, "").trim());
    }
  }
  return out.join("\n");
}

async function sheet(buf: Buffer, ext: string): Promise<string> {
  if (ext === ".csv") {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, ""); }
    catch { return new TextDecoder("latin1").decode(buf); }
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const out: string[] = [];
  for (const name of wb.SheetNames) {
    out.push(`--- planilha ${name} ---`);
    out.push(XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: "|", blankrows: false }));
  }
  return out.join("\n");
}

export async function toText(nome: string, buf: Buffer, uso?: Uso): Promise<string> {
  const ext = path.extname(nome).toLowerCase();
  let txt: string;
  if ([".txt", ".md", ".json"].includes(ext)) txt = buf.toString("utf-8");
  else if (ext === ".vtt") txt = vtt(buf.toString("utf-8"));
  else if (ext === ".docx") txt = await docx(buf);
  else if (ext === ".odt") txt = await odt(buf);
  else if (ext === ".pdf") txt = await pdf(buf);
  else if (ext === ".pptx") txt = await pptx(buf);
  else if ([".xlsx", ".xls", ".csv"].includes(ext)) txt = await sheet(buf, ext);
  else if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext))
    txt = await transcreverImagem(new Uint8Array(buf), ext === ".png" ? "png" : ext === ".webp" ? "webp" : "jpeg", PROMPT_IMAGEM, uso);
  else throw new Error(`Formato não suportado: ${ext || "sem extensão"}`);
  txt = txt.trim();
  if (txt.length < 20) throw new Error(`Não consegui extrair texto de ${nome} (PDF escaneado? envie como imagem)`);
  return txt;
}
