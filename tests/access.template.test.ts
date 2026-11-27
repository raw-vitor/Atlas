import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(process.cwd(), "access", "login.html"), "utf8");

describe("template de login do Access", () => {
  it("tem exatamente um cf-access-authbox, fora de condições Liquid", () => {
    expect(html.match(/<cf-access-authbox>\s*<\/cf-access-authbox>/g)).toHaveLength(1);
    expect(html.match(/<cf-access-authbox/g)).toHaveLength(1);
    const antes = html.slice(0, html.indexOf("<cf-access-authbox"));
    const abre = (antes.match(/{%-?\s*(if|unless|for|case)\b/g) ?? []).length;
    const fecha = (antes.match(/{%-?\s*end(if|unless|for|case)\b/g) ?? []).length;
    expect(abre).toBe(fecha);
  });

  it("não tem script nem handlers inline", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  it("não referencia recursos que não sejam HTTPS", () => {
    for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
      expect(m[1]).toMatch(/^https:\/\//);
    }
    for (const m of html.matchAll(/url\(\s*["']?([^"')]*)/gi)) {
      expect(m[1]).toMatch(/^https:\/\//);
    }
  });

  it("mostra message.text quando houver texto", () => {
    expect(html).toContain("message.text.size > 0");
    expect(html).toMatch(/role="status"[^>]*>\s*{{\s*message\.text\s*}}/);
  });

  it("não promete código por e-mail", () => {
    expect(html).not.toMatch(/c[óo]digo/i);
  });
});
