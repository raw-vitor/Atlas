import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ACCEPT, EXT_OK } from "../lib/formatos";
import { toText, vtt } from "../lib/ingest";

describe("formatos novos", () => {
  it("accept inclui webp, odt e vtt", () => {
    for (const e of [".webp", ".odt", ".vtt"]) { expect(EXT_OK).toContain(e); expect(ACCEPT).toContain(e); }
  });
  it("vtt mantém só as falas", async () => {
    const v = "WEBVTT\n\nNOTE x\n\n1\n00:00:01.000 --> 00:00:03.000\nLuiz: Bom dia, vamos falar da carteira.\n\n2\n00:00:04.000 --> 00:00:06.000\n<v Ana>Tenho 500 mil na poupança e quero diversificar.</v>\n";
    const t = vtt(v);
    expect(t).toBe("Luiz: Bom dia, vamos falar da carteira.\nTenho 500 mil na poupança e quero diversificar.");
    expect(await toText("r1.vtt", Buffer.from(v))).toContain("Luiz: Bom dia");
  });
  it("odt: um parágrafo por linha", async () => {
    const z = new JSZip();
    z.file("content.xml", '<office:text><text:h>Reunião R1</text:h><text:p>Luiz: bom dia <text:s/>tudo bem &amp; você?</text:p><text:p>Ana: tudo certo, quero investir.</text:p></office:text>');
    const buf = await z.generateAsync({ type: "nodebuffer" });
    expect(await toText("r1.odt", buf)).toBe("Reunião R1\nLuiz: bom dia  tudo bem & você?\nAna: tudo certo, quero investir.");
  });
  it("docx: um parágrafo por linha (mammoth com buffer e arrayBuffer, como no Worker)", async () => {
    const z = new JSZip();
    z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Luiz: bom dia, vamos falar da carteira.</w:t></w:r></w:p><w:p><w:r><w:t>Ana: tenho 500 mil na poupança &amp; quero diversificar.</w:t></w:r></w:p></w:body></w:document>');
    const buf = await z.generateAsync({ type: "nodebuffer" });
    expect(await toText("r1.docx", buf)).toBe("Luiz: bom dia, vamos falar da carteira.\n\nAna: tenho 500 mil na poupança & quero diversificar.");
  });
});
