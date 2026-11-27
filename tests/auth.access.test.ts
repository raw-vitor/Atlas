/**
 * Verificador do Cloudflare Access (lib/auth.ts, plano de login A2/A4/A9). Roda em Node, sem rede: o par RSA é gerado na hora e as
 * chaves públicas entram por `obterChaves` (`createLocalJWKSet`). `usuarioAtual`/`identificar` com o verificador real ficam em
 * tests/workers/rotas.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { definirVerificadorAcesso, emProducao, identificar, idDoEmail, verificadorAccess } from "../lib/auth";

const TEAM = "https://atlas-teste.cloudflareaccess.com";
const AUD = "aud-atlas-teste";
const env = (extra: Partial<CloudflareEnv> = {}) => ({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...extra }) as CloudflareEnv;
const req = (token?: string) => new Request("https://atlas.local/api/conversas", { headers: token ? { "cf-access-jwt-assertion": token } : {} });

let privada: CryptoKey;
let outraPrivada: CryptoKey;
let chaves: JWTVerifyGetKey;
const times: string[] = [];
const obterChaves = (team: string) => {
  times.push(team);
  return chaves;
};

beforeAll(async () => {
  const par = await generateKeyPair("RS256");
  privada = par.privateKey;
  outraPrivada = (await generateKeyPair("RS256")).privateKey;
  chaves = createLocalJWKSet({ keys: [{ ...(await exportJWK(par.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
});

interface Opc {
  email?: unknown;
  aud?: string;
  iss?: string;
  exp?: string | number;
  nbf?: string | number;
  chave?: CryptoKey | Uint8Array;
  alg?: string;
}

function assinar(o: Opc = {}) {
  const claims: Record<string, unknown> = {};
  if (!("email" in o)) claims.email = "Ana.Silva@EQI.com.br";
  else if (o.email !== undefined) claims.email = o.email;
  const alg = o.alg ?? "RS256";
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg, kid: "k1" })
    .setIssuer(o.iss ?? TEAM)
    .setAudience(o.aud ?? AUD)
    .setSubject("sub-que-nao-vira-id")
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "10m");
  if (o.nbf !== undefined) jwt.setNotBefore(o.nbf);
  return jwt.sign(o.chave ?? (alg === "HS256" ? new TextEncoder().encode("segredo-compartilhado-com-32-bytes!!") : privada));
}

const verificar = (token: string | undefined, e = env(), v = verificadorAccess(obterChaves)) => v.verificar(req(token), e);

describe("verificadorAccess", () => {
  it("token válido devolve o usuário com o e-mail em minúsculas e id derivado do e-mail (o sub não vira id)", async () => {
    const u = await verificar(await assinar());
    expect(u).toEqual({ id: await idDoEmail("ana.silva@eqi.com.br"), email: "ana.silva@eqi.com.br" });
    expect(u!.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("team domain com barra no fim funciona e as chaves são pedidas sem a barra", async () => {
    times.length = 0;
    const u = await verificar(await assinar(), env({ ACCESS_TEAM_DOMAIN: `${TEAM}/` }));
    expect(u?.email).toBe("ana.silva@eqi.com.br");
    expect(times).toEqual([TEAM]);
  });

  it("recusa aud errado, iss errado, vencido, nbf no futuro, chave de outro par e alg HS256", async () => {
    const agora = Math.floor(Date.now() / 1000);
    const casos: Record<string, Opc> = {
      "aud errado": { aud: "outra-aplicacao" },
      "iss errado": { iss: "https://outro.cloudflareaccess.com" },
      vencido: { exp: agora - 3600 },
      "nbf no futuro": { nbf: agora + 3600 },
      "outra chave": { chave: outraPrivada },
      HS256: { alg: "HS256" },
    };
    for (const [nome, o] of Object.entries(casos)) expect(await verificar(await assinar(o)), nome).toBeNull();
  });

  it("recusa token sem email, com e-mail inválido ou que não é texto", async () => {
    for (const email of [undefined, "isso-nao-e-email", "a b@eqi.com.br", "", 42, ["ana@eqi.com.br"]]) {
      expect(await verificar(await assinar({ email })), JSON.stringify(email)).toBeNull();
    }
  });

  it("recusa cabeçalho ausente, vazio ou que não é um JWT", async () => {
    expect(await verificar(undefined)).toBeNull();
    expect(await verificar("")).toBeNull();
    expect(await verificar("isso.nao.eh-jwt")).toBeNull();
    expect(await verificar("lixo")).toBeNull();
  });

  it("sem ACCESS_TEAM_DOMAIN ou ACCESS_AUD devolve null sem tentar validar (falha fechada)", async () => {
    times.length = 0;
    const token = await assinar();
    for (const extra of [{ ACCESS_TEAM_DOMAIN: "" }, { ACCESS_AUD: "" }, { ACCESS_TEAM_DOMAIN: undefined }, { ACCESS_AUD: undefined }, { ACCESS_TEAM_DOMAIN: "  " }]) {
      expect(await verificar(token, env(extra as Partial<CloudflareEnv>))).toBeNull();
    }
    expect(times).toEqual([]);
  });

  it("erro ao obter as chaves (rede fora, JWKS inválido) devolve null em vez de lançar", async () => {
    const quebrado = verificadorAccess(() => async () => {
      throw new Error("sem rede");
    });
    expect(await verificar(await assinar(), env(), quebrado)).toBeNull();
  });
});

describe("identificar e emProducao", () => {
  const dev = (extra: Partial<CloudflareEnv> = {}) => env({ ENVIRONMENT: "development", ...extra });

  it("emProducao só é true com ENVIRONMENT=production", () => {
    expect(emProducao(env({ ENVIRONMENT: "production" }))).toBe(true);
    expect(emProducao(env({ ENVIRONMENT: "staging" }))).toBe(false);
    expect(emProducao(dev())).toBe(false);
  });

  it("fora de produção usa o cabeçalho de dev, depois ATLAS_DEV_USUARIO, e ignora o JWT", async () => {
    const r = (h: Record<string, string>) => new Request("https://atlas.local/", { headers: h });
    expect((await identificar(r({ "x-atlas-dev-usuario": "Bia@eqi.local" }), dev()))?.email).toBe("bia@eqi.local");
    expect((await identificar(r({}), dev({ ATLAS_DEV_USUARIO: "cris@eqi.local" })))?.email).toBe("cris@eqi.local");
    expect(await identificar(r({ "x-atlas-dev-usuario": "isso-nao-e-email" }), dev())).toBeNull();
    const comJwt = r({ "cf-access-jwt-assertion": await assinar() });
    expect((await identificar(comJwt, dev({ ATLAS_DEV_USUARIO: "cris@eqi.local" })))?.email).toBe("cris@eqi.local");
  });

  it("em produção só vale o verificador: cabeçalho de dev é ignorado e o verificador injetado é usado", async () => {
    const prod = env({ ENVIRONMENT: "production" });
    definirVerificadorAcesso(verificadorAccess(obterChaves));
    const headerDev = new Request("https://atlas.local/", { headers: { "x-atlas-dev-usuario": "bia@eqi.local" } });
    expect(await identificar(headerDev, prod)).toBeNull();
    const r = new Request("https://atlas.local/", { headers: { "cf-access-jwt-assertion": await assinar({ email: "dani@eqi.local" }), "x-atlas-dev-usuario": "bia@eqi.local" } });
    expect((await identificar(r, prod))?.email).toBe("dani@eqi.local");
  });
});
