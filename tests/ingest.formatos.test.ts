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
});
