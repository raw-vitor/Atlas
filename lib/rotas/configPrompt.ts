/** `GET/PUT/DELETE /api/configuracoes/prompt`: configuração do prompt do assessor. */
import { negado, usuarioAtual } from "../auth";
import { env } from "../cf";
import { gravarConfigPrompt, lerConfigPrompt } from "../db/configPrompt";
import { BLOCOS, CATEGORIAS_INFO, validarConfig } from "../prompt-blocos";
import { tamanhoKb } from "../prompt-montagem";
import { ETAPAS, LIMITES, type Etapa, type RespostaConfig } from "../prompt-tipos";
import { erro, protegida } from "./comum";

/**
 * Teto do corpo do PUT. O maior documento válido tem `LIMITES.extras` instruções e um texto por bloco original, todos com até
 * `LIMITES.textoBloco` caracteres (até 2 bytes cada em português) mais o JSON em volta; o dobro disso ainda é pequeno.
 */
export const MAX_CORPO_BYTES = 2 * (LIMITES.extras + BLOCOS.length) * LIMITES.textoBloco * 2 + 16_384;

/** Lê o corpo como JSON sem passar de `MAX_CORPO_BYTES`. `"grande"` se passar; null se ausente, malformado ou não for objeto. */
async function lerCorpoLimitado(req: Request): Promise<Record<string, unknown> | null | "grande"> {
  const declarado = Number(req.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_CORPO_BYTES) return "grande";
  if (!req.body) return null;
  const leitor = req.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CORPO_BYTES) { await leitor.cancel().catch(() => undefined); return "grande"; }
    pedacos.push(value);
  }
  const todo = new Uint8Array(total);
  let pos = 0;
  for (const p of pedacos) { todo.set(p, pos); pos += p.byteLength; }
  try {
    const c = JSON.parse(new TextDecoder().decode(todo)) as unknown;
    return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

let tamanhos: Record<Etapa, number> | undefined;
const tamanhosKb = (): Record<Etapa, number> =>
  (tamanhos ??= Object.fromEntries(ETAPAS.map((e) => [e, tamanhoKb(e)])) as Record<Etapa, number>);

async function resposta(e: CloudflareEnv, usuarioId: string): Promise<RespostaConfig> {
  return { categorias: CATEGORIAS_INFO, blocos: BLOCOS, config: await lerConfigPrompt(e, usuarioId), tamanhoKb: tamanhosKb() };
}

const conflito = async (e: CloudflareEnv, usuarioId: string) =>
  erro("Esta configuração mudou em outra aba.", 409, { atual: await resposta(e, usuarioId) });

export function getConfigPrompt(req: Request, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("configPrompt.GET", async () => {
    const e = env(injetado);
    const usuario = await usuarioAtual(req, e);
    if (!usuario) return negado();
    return Response.json(await resposta(e, usuario.id), { headers: { "cache-control": "no-store" } });
  });
}

export function putConfigPrompt(req: Request, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("configPrompt.PUT", async () => {
    const e = env(injetado);
    const usuario = await usuarioAtual(req, e);
    if (!usuario) return negado();
    const corpo = await lerCorpoLimitado(req);
    if (corpo === "grande") return erro("O corpo da requisição é grande demais.", 413);
    if (!corpo) return erro("Corpo inválido.", 400);
    const { versao } = corpo;
    if (typeof versao !== "number" || !Number.isInteger(versao) || versao < 0) return erro("Versão inválida. Recarregue a página e tente de novo.", 400);
    const v = validarConfig(corpo);
    if (!v.ok) return erro(v.erro, 400);
    if ((await gravarConfigPrompt(e, usuario.id, versao, v.dados)) === null) return conflito(e, usuario.id);
    return Response.json(await resposta(e, usuario.id), { headers: { "cache-control": "no-store" } });
  });
}

/**
 * Restaurar tudo: grava a config vazia com a versão seguinte. A linha não é apagada (a versão nunca volta a um número já usado).
 * Se outra gravação chegar entre a leitura e a escrita, relê e tenta mais uma vez; persistindo a corrida, responde 409.
 */
export function deleteConfigPrompt(req: Request, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("configPrompt.DELETE", async () => {
    const e = env(injetado);
    const usuario = await usuarioAtual(req, e);
    if (!usuario) return negado();
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const { versao } = await lerConfigPrompt(e, usuario.id);
      if ((await gravarConfigPrompt(e, usuario.id, versao, { alterados: {}, extras: [] })) !== null)
        return Response.json(await resposta(e, usuario.id), { headers: { "cache-control": "no-store" } });
    }
    return conflito(e, usuario.id);
  });
}
