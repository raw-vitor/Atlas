/**
 * Configuração do prompt por assessor em D1 (migrations/0002_config_prompt.sql). Consultas parametrizadas, sempre por
 * `usuarioId` vindo de `usuarioAtual` (rotas) ou da mensagem da fila (consumidores, dono já conferido).
 * A validação do conteúdo fica em `validarConfig` (lib/prompt-blocos.ts); aqui só se lê e grava.
 */
import { configVazia, type ConfigPrompt, type DadosConfig } from "../prompt-tipos";

/** Config do usuário, ou a vazia com versão 0 se ele nunca salvou. JSON corrompido também cai na vazia (mantendo a versão). */
export async function lerConfigPrompt(e: CloudflareEnv, usuarioId: string): Promise<ConfigPrompt> {
  const l = await e.DB.prepare("SELECT dados, versao FROM config_prompt WHERE usuario_id = ?")
    .bind(usuarioId).first<{ dados: string; versao: number }>();
  if (!l) return configVazia();
  try {
    const d = JSON.parse(l.dados) as Partial<DadosConfig>;
    return { versao: l.versao, alterados: d.alterados ?? {}, extras: d.extras ?? [] };
  } catch {
    return configVazia(l.versao);
  }
}

/**
 * Grava se a versão atual for `versaoEsperada` (concorrência otimista). Devolve a nova versão, ou null se outra gravação
 * chegou antes (a rota responde 409). Versão 0 = ainda não existe linha.
 */
export async function gravarConfigPrompt(
  e: CloudflareEnv, usuarioId: string, versaoEsperada: number, dados: DadosConfig,
): Promise<number | null> {
  const nova = versaoEsperada + 1;
  const json = JSON.stringify({ alterados: dados.alterados, extras: dados.extras });
  const agora = Date.now();
  const r = versaoEsperada === 0
    ? await e.DB.prepare("INSERT INTO config_prompt (usuario_id, dados, versao, atualizada) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(usuarioId, json, nova, agora).run()
    : await e.DB.prepare("UPDATE config_prompt SET dados = ?, versao = ?, atualizada = ? WHERE usuario_id = ? AND versao = ?")
      .bind(json, nova, agora, usuarioId, versaoEsperada).run();
  return r.meta.changes === 1 ? nova : null;
}
