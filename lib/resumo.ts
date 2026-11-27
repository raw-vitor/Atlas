import type { Caso } from "./caso";
import { PENDENCIAS_FIXAS } from "./validate";
import { avisosDosDados, prontidao, valoresParaCarteira } from "./caso";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const TIPOS: Record<string, string> = { extrato: "extrato", transcricao_r1: "transcrição da R1", deck_anterior: "deck anterior", anotacoes: "anotações", outro: "outro documento" };
const rotuloPapel = (p: string) => (p === "carteira" ? "carteira" : p === "contexto" ? "contexto" : "transcrição");
/** O que o Atlas entendeu do arquivo: o tipo (se o LLM decidiu) e o uso que fez dele. */
const rotulo = (f: { papel: string; tipo?: string }) =>
  f.tipo && TIPOS[f.tipo] ? `${TIPOS[f.tipo]}, usado como ${rotuloPapel(f.papel)}${f.papel === "contexto" ? " do lead" : ""}` : rotuloPapel(f.papel);

/** Texto fixo da Fase 1: o que o Atlas entendeu e o que falta. Sem LLM. Curto, em bullets. */
export function resumoDoCaso(c: Caso, novos: string[], avisosTriagem: string[] = []): string {
  const l: string[] = [];
  const lidos = novos.map((n) => ({ n, f: c.fontes.find((x) => x.nome === n) })).filter((x) => x.f);
  if (lidos.length === 1) l.push(`Li ${lidos[0].n} (${rotulo(lidos[0].f!)}).`);
  else if (lidos.length) l.push(`Li ${lidos.length} arquivos:\n${lidos.map((x) => `- ${x.n}: ${rotulo(x.f!)}`).join("\n")}`);

  const info: string[] = [];
  if (c.analise) info.push(`- Carteira: ${c.analise.n_ativos} ativos, ${brl(c.analise.total)}`);
  if (c.lead) {
    const p = [c.lead.primeiro_nome && `Lead: ${c.lead.primeiro_nome}`, c.lead.perfil].filter(Boolean).join(", ");
    if (p) info.push(`- ${p}`);
    const [primeiro, ...resto] = c.lead.objetivos;
    if (primeiro) info.push(`- Objetivo: ${primeiro}${resto.length ? ` (+${resto.length} no painel)` : ""}`);
  }
  if (info.length) l.push(info.join("\n"));

  // Só o que o assessor precisa resolver. As pendências fixas do método ficam no painel do deck.
  // Com rascunho, os avisos são os mesmos do cartão do deck (já incluem as citações).
  const dados = avisosDosDados(c);
  const citacoes = dados.avisos.length;
  const fixas = new Set(PENDENCIAS_FIXAS);
  const antes = [...new Set([
    ...c.avisosLeitura, ...c.pendenciasCarteira, ...avisosTriagem,
    ...dados.pendencias.filter((p) => !fixas.has(p)).map((p) => p.charAt(0).toUpperCase() + p.slice(1)),
    ...(c.rascunho ? c.rascunho.avisos.map((a) => a.texto)
      : citacoes ? [`${citacoes} ${citacoes === 1 ? "citação do lead não bate" : "citações do lead não batem"} com a transcrição`] : []),
  ])];
  if (antes.length) l.push(`Antes da R2:\n${antes.map((a) => `- ${a}`).join("\n")}`);

  const pr = prontidao(c);
  if (pr.pronto) {
    const padrao = [!c.assessor && "assessor", !c.dataR2 && "data da R2"].filter(Boolean);
    l.push(`Pronto para gerar os slides.${padrao.length ? ` ${(padrao.join(" e ") as string).replace(/^./, (m) => m.toUpperCase())} ${padrao.length > 1 ? "ficaram" : "ficou"} no padrão.` : ""}`);
  } else l.push(pedido(c, pr));
  return l.join("\n\n");
}

const OPCAO_ENVIAR = "Enviar a carteira: anexe o extrato (planilha, PDF ou print) ou cole a posição aqui no chat.";

/** O que o assessor precisa fazer, em linguagem de ação. */
function pedido(c: Caso, pr: ReturnType<typeof prontidao>): string {
  const semCarteira = pr.itens.find((i) => i.chave === "ativos")!.ok === false;
  const temTranscricao = c.fontes.some((f) => f.papel === "transcricao");
  if (!temTranscricao) {
    const o = [semCarteira && "a carteira do lead", "a transcrição da R1"].filter(Boolean).join(" e ");
    return `Falta ${o}. Anexe os arquivos ou cole o texto aqui.`;
  }
  const citados = valoresParaCarteira(c);
  const usar = citados.length ? `Usar só a transcrição: a R1 cita ${citados.map((t) => `"${t}"`).join("; ")}. Monto a carteira com esses valores, marcados como aproximados, e sigo.` : "";
  const dica = `Responda "usar a transcrição" ou clique no botão abaixo.`;
  if (semCarteira && pr.faltas.length === 1) {
    if (!citados.length) return `Falta a carteira do lead. A transcrição não cita valores investidos, então preciso da carteira. ${OPCAO_ENVIAR.replace("Enviar a carteira: anexe", "Anexe")}`;
    return `Falta a carteira do lead. Escolha uma opção:\n1. ${OPCAO_ENVIAR}\n2. ${usar}\n${dica}`;
  }
  const linhas = pr.faltasAcoes.map((a, i) => `${i + 1}. ${a}`);
  return `Para gerar os slides, preciso de:\n${linhas.join("\n")}${citados.length ? `\nPara a carteira, também posso ${usar.charAt(0).toLowerCase()}${usar.slice(1)} ${dica}` : ""}`;
}
