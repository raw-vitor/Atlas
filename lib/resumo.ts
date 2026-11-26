import type { Caso } from "./caso";
import { prontidao, valoresParaCarteira } from "./caso";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const TIPOS: Record<string, string> = { extrato: "extrato", transcricao_r1: "transcrição da R1", deck_anterior: "deck anterior", anotacoes: "anotações", outro: "outro documento" };
const rotuloPapel = (p: string) => (p === "carteira" ? "carteira" : p === "contexto" ? "contexto" : "transcrição");
/** O que o Atlas entendeu do arquivo: o tipo (se o LLM decidiu) e o uso que fez dele. */
const rotulo = (f: { papel: string; tipo?: string }) =>
  f.tipo && TIPOS[f.tipo] ? `${TIPOS[f.tipo]}, usado como ${rotuloPapel(f.papel)}${f.papel === "contexto" ? " do lead" : ""}` : rotuloPapel(f.papel);

/** Texto fixo da Fase 1: o que o Atlas entendeu e o que falta. Sem LLM. */
export function resumoDoCaso(c: Caso, novos: string[]): string {
  const l: string[] = [];
  if (novos.length) l.push(`Li ${novos.map((n) => { const f = c.fontes.find((x) => x.nome === n)!; return `${n} (${rotulo(f)})`; }).join(", ")}.`);
  if (c.analise) l.push(`Carteira: ${c.analise.n_ativos} ativos, total ${brl(c.analise.total)}.`);
  if (c.lead) {
    const partes = [c.lead.primeiro_nome && `lead ${c.lead.primeiro_nome}`, c.lead.perfil && `perfil ${c.lead.perfil}`,
      c.lead.objetivos.length ? `objetivos: ${c.lead.objetivos.join("; ")}` : ""].filter(Boolean);
    if (partes.length) l.push(`Lead: ${partes.join(", ")}.`);
  }
  for (const a of c.avisosLeitura) l.push(`Atenção: ${a}`);
  for (const p of c.pendenciasCarteira) l.push(`Atenção: ${p}`);
  const pr = prontidao(c);
  if (pr.pronto) {
    const padrao = [!c.assessor && "assessor", !c.dataR2 && "data da R2"].filter(Boolean);
    l.push(`Tenho o necessário para montar os slides. Use o botão "Gerar slides" quando quiser.${padrao.length ? ` Você não informou ${padrao.join(" e ")}; uso o padrão.` : ""}`);
  } else l.push(pedido(c, pr));
  return l.join("\n");
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
