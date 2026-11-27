#!/usr/bin/env node
// Gera fixtures sintéticos (sem dados de cliente) em spike/.fixtures/ a partir de tests/fixtures.
// Pequenos: docx, pdf, xlsx, pptx, odt, vtt. Grandes (~25 MB): pdf-texto, pdf-imagem, xlsx, pptx, docx.
// Uso: node spike/gerar-fixtures.mjs [--sem-grandes]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "..");
const saida = path.join(aqui, ".fixtures");
const require = createRequire(path.join(raiz, "package.json"));
const JSZip = require("jszip");
const XLSX = require("xlsx");
fs.mkdirSync(saida, { recursive: true });

const MB = 1024 * 1024;
const grava = (nome, buf) => { fs.writeFileSync(path.join(saida, nome), buf); console.log(nome.padEnd(28), (buf.length / MB).toFixed(2).padStart(7), "MB"); };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const transcricao = fs.readFileSync(path.join(raiz, "tests/fixtures/transcricao_elisandro.txt"), "utf-8");
const linhas = transcricao.split(/\r?\n/).filter((l) => l.trim());
const zip = (z) => z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
const aleatorio = (n) => { const b = Buffer.allocUnsafe(n); for (let i = 0; i < n; i += 65536) crypto.randomFillSync(b, i, Math.min(65536, n - i)); return b; };

// ---------- docx
const CT_DOCX = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const REL_RAIZ = (alvo) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${alvo}"/></Relationships>`;
async function docx(extraMb = 0) {
  const z = new JSZip();
  z.file("[Content_Types].xml", CT_DOCX);
  z.file("_rels/.rels", REL_RAIZ("word/document.xml"));
  const ps = linhas.map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join("");
  z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${ps}</w:body></w:document>`);
  if (extraMb) z.file("word/media/anexo.bin", aleatorio(extraMb * MB), { compression: "STORE" });
  return zip(z);
}

// ---------- pptx
const CT_PPTX = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/></Types>';
async function pptx(extraMb = 0) {
  const z = new JSZip();
  z.file("[Content_Types].xml", CT_PPTX);
  z.file("_rels/.rels", REL_RAIZ("ppt/presentation.xml"));
  z.file("ppt/presentation.xml", '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
  for (let i = 0; i < Math.ceil(linhas.length / 8); i++) {
    const ps = linhas.slice(i * 8, i * 8 + 8).map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join("");
    z.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${ps}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  }
  if (extraMb) z.file("ppt/media/imagem.bin", aleatorio(extraMb * MB), { compression: "STORE" });
  return zip(z);
}

// ---------- odt, vtt
async function odt() {
  const z = new JSZip();
  z.file("content.xml", `<office:text>${linhas.map((l) => `<text:p>${esc(l)}</text:p>`).join("")}</office:text>`);
  return zip(z);
}
const vtt = () => "WEBVTT\n\n" + linhas.map((l, i) => `${i + 1}\n00:00:${String(i % 60).padStart(2, "0")}.000 --> 00:00:${String((i + 1) % 60).padStart(2, "0")}.000\n${l}\n`).join("\n");

// ---------- pdf escrito à mão (Helvetica, sem compressão)
function montarPdf(paginas, imagemBytes = 0) {
  const partes = [];
  const offs = [];
  let pos = 0;
  const push = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, "latin1"); partes.push(buf); pos += buf.length; };
  const obj = (n, corpo) => { offs[n] = pos; push(`${n} 0 obj\n`); push(corpo); push("\nendobj\n"); };
  const n = paginas.length;
  const idPag = (i) => 5 + i * 2, idCont = (i) => 6 + i * 2;
  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${paginas.map((_, i) => `${idPag(i)} 0 R`).join(" ")}] >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const idImg = 5 + n * 2;
  if (imagemBytes) {
    offs[idImg] = pos; push(`${idImg} 0 obj\n<< /Type /XObject /Subtype /Image /Width 4096 /Height ${Math.ceil(imagemBytes / 4096 / 3)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${imagemBytes} >>\nstream\n`);
    push(aleatorio(imagemBytes)); push("\nendstream\nendobj\n");
  }
  obj(4, "<< >>");
  paginas.forEach((ls, i) => {
    const fluxo = "BT /F1 10 Tf 40 780 Td 12 TL\n" + ls.map((l) => `(${l.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?")}) Tj T*`).join("\n") + "\nET" + (imagemBytes && i === 0 ? `\nq 500 0 0 500 40 100 cm /Im1 Do Q` : "");
    obj(idPag(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >>${imagemBytes && i === 0 ? ` /XObject << /Im1 ${idImg} 0 R >>` : ""} >> /Contents ${idCont(i)} 0 R >>`);
    obj(idCont(i), `<< /Length ${Buffer.byteLength(fluxo, "latin1")} >>\nstream\n${fluxo}\nendstream`);
  });
  const total = (imagemBytes ? idImg : 4 + n * 2) + 1;
  const xref = pos;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let k = 1; k < total; k++) push(String(offs[k] ?? 0).padStart(10, "0") + " 00000 n \n");
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(partes);
}
const pagina = (i) => Array.from({ length: 58 }, (_, j) => `Pagina ${i + 1} linha ${j + 1}: ${linhas[(i * 7 + j) % linhas.length].slice(0, 100)}`);
const pdfTexto = (mb) => { const alvoPag = Math.ceil((mb * MB) / 4300); return montarPdf(Array.from({ length: alvoPag }, (_, i) => pagina(i))); };

// ---------- xlsx
const CT_XLSX = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
const VOCAB = ["PETR4", "VALE3", "ITUB4", "CDB BANCO X 2029", "LCI LCA", "FII HGLG11", "Tesouro IPCA+ 2035", "Fundo Multimercado", "Acao", "Renda Fixa"];
function linhaXlsx(r) {
  const col = "ABCDEFGHIJ";
  let s = `<row r="${r}">`;
  for (let c = 0; c < 10; c++) {
    s += c < 6
      ? `<c r="${col[c]}${r}"><v>${(Math.random() * 1e6).toFixed(2)}</v></c>`
      : `<c r="${col[c]}${r}" t="inlineStr"><is><t>${VOCAB[(Math.random() * VOCAB.length) | 0]} ${(Math.random() * 1e4) | 0}</t></is></c>`;
  }
  return s + "</row>";
}
async function xlsxManual(linhasN) {
  const z = new JSZip();
  z.file("[Content_Types].xml", CT_XLSX);
  z.file("_rels/.rels", REL_RAIZ("xl/workbook.xml"));
  z.file("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Carteira" sheetId="1" r:id="rId1"/></sheets></workbook>');
  z.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  const blocos = [];
  for (let r = 1; r <= linhasN; r += 20000) { const p = []; for (let k = r; k < Math.min(r + 20000, linhasN + 1); k++) p.push(linhaXlsx(k)); blocos.push(p.join("")); }
  z.file("xl/worksheets/sheet1.xml", `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${blocos.join("")}</sheetData></worksheet>`);
  return zip(z);
}
/** Calibra o número de linhas para o arquivo final ficar perto do alvo (o xlsx comprime ~constante por linha). */
async function xlsxAlvo(mb) {
  const amostra = (await xlsxManual(20000)).length;
  const porLinha = amostra / 20000;
  return xlsxManual(Math.round((mb * MB) / porLinha));
}
function xlsxPequeno() {
  const wb = XLSX.utils.book_new();
  const csv = fs.readFileSync(path.join(raiz, "tests/fixtures/carteira_elisandro.csv"), "utf-8");
  const aoa = csv.split(/\r?\n/).filter(Boolean).map((l) => l.split(/[;,]/));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Carteira");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ---------- execução
grava("pequeno.docx", await docx());
grava("pequeno.pptx", await pptx());
grava("pequeno.odt", await odt());
grava("pequeno.vtt", Buffer.from(vtt()));
grava("pequeno.pdf", montarPdf(Array.from({ length: 6 }, (_, i) => pagina(i))));
grava("pequeno.xlsx", xlsxPequeno());
grava("medio-1mb.xlsx", await xlsxAlvo(1));
grava("medio-5mb.xlsx", await xlsxAlvo(5));
grava("medio-5mb.pdf", pdfTexto(5));
if (!process.argv.includes("--sem-grandes")) {
  grava("grande-25mb.docx", await docx(25));
  grava("grande-25mb.pptx", await pptx(25));
  grava("grande-25mb-texto.pdf", pdfTexto(25));
  grava("grande-25mb-imagem.pdf", montarPdf(Array.from({ length: 3 }, (_, i) => pagina(i)), 25 * MB));
  grava("grande-25mb.xlsx", await xlsxAlvo(25));
}
