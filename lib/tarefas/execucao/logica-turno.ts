/**
 * A lógica de um turno de conversa (mensagem do assessor com ou sem anexos), sem Durable Object, D1 nem R2: recebe o caso, o texto,
 * os arquivos já baixados e uma função `enviar`; muda o caso e devolve o texto da resposta. É o corpo do antigo
 * `POST /api/conversas/{id}/mensagens`, na mesma ordem de decisões. Quem a executa (turno.ts) cuida da fila, do cancelamento, da
 * persistência e dos eventos.
 */
import { criarChatJson, type Uso } from "../../bedrock";
import { CanceladoError, checarCancelado } from "../../cancelamento";
import { aplicarAjustes, descartarRascunho, eDerivada, hashTexto, prontidao, publicoCaso, rebaixarCarteirasSubstituiveis, registrar, removerDerivada,
  temCarteiraReal, temExtrato, tocar, valoresParaCarteira, type Caso, type Fonte } from "../../caso";
import { interpretar, type LeitorDeArquivo } from "../../chat";
import { responderPergunta } from "../../conversa";
import { interpretarInstrucao, MAX_INSTRUCAO } from "../../instrucao";
import { derivarCarteira, leitura } from "../../pipeline";
import type { ConfigPrompt } from "../../prompt-tipos";
import { resumoDoCaso } from "../../resumo";
import { eSubstituivelPorExtrato as eSubstituivel } from "../../triagem-llm";
import { ErroDeTarefa } from "./erros";

/** `atividade`: progresso da leitura (`{pct, msg}`). `texto`: a resposta do Atlas. `caso`: o estado público depois da mudança. */
export type EnviarTurno = (evento: "atividade" | "texto" | "caso", dados: unknown) => void;


export interface EntradaTurno {
  caso: Caso;
  /** Texto digitado pelo assessor. */
  texto: string;
  /** Anexos já baixados do R2. */
  arquivos: { nome: string; buf: Buffer }[];
  uso: Uso;
  enviar: EnviarTurno;
  /** Converte arquivo em texto. Padrão: `toText` (tudo em processo). O consumidor passa o leitor que usa o Container. */
  leitor?: LeitorDeArquivo;
  /** Config de prompt do assessor (snapshot da tarefa). Sem ela, vale o prompt original. */
  config?: ConfigPrompt;
}

/** Monta a carteira com os valores que o lead citou na R1. Devolve a frase com o resultado. */
async function usarTranscricao(caso: Caso, uso: Uso, enviar: EnviarTurno, config?: ConfigPrompt): Promise<string> {
  if (!caso.fontes.some((f) => f.papel === "transcricao")) return "Ainda não recebi a transcrição da R1. Anexe o arquivo ou cole o texto aqui.";
  if (temCarteiraReal(caso)) return "A carteira enviada já está em uso. Não preciso dos valores da transcrição.";
  const SEM_VALOR = "Não achei valores investidos na fala do lead. Preciso da carteira: anexe o extrato ou cole a posição aqui.";
  if (!valoresParaCarteira(caso).length && !caso.fontes.some(eDerivada)) return SEM_VALOR;
  enviar("atividade", { pct: 5, msg: "Lendo os valores citados na R1" });
  const ativos = await derivarCarteira(caso, criarChatJson(uso), (_etapa, pct, m) => enviar("atividade", { pct, msg: m }), config);
  if (!ativos.length) return SEM_VALOR;
  const lista = ativos.map((a) => `${a.nome}, ${a.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`).join("; ");
  return `Montei a carteira com o que o lead disse na R1: ${lista} (aproximado). Confirme o extrato antes da R2.`;
}

const NAO_ENTENDI = "Não entendi o pedido. Posso gerar os slides, anotar nome, perfil ou objetivo do lead, usar a transcrição da R1 " +
  "e responder perguntas sobre o caso (ex.: \"de onde veio o R$ 10 mil?\").";

/**
 * Executa o turno. Muda `caso` e emite exatamente um `texto` e um `caso` ao final. Lança `CanceladoError` se o fluxo for cancelado
 * (o chamador restaura o caso) e `ErroDeTarefa` para falhas com mensagem pronta; qualquer outro erro sobe como está.
 */
export async function rodarTurno(entrada: EntradaTurno): Promise<{ texto: string }> {
  const { caso, texto: msg, arquivos, uso, leitor, config } = entrada;
  let resposta = "";
  // Histórico no servidor: a mensagem do assessor e todo texto que o Atlas responde.
  registrar(caso, "assessor", [msg.trim(), arquivos.length ? `(anexou: ${arquivos.map((f) => f.nome).join(", ")})` : ""].filter(Boolean).join(" "));
  const enviar: EnviarTurno = (evento, dados) => {
    if (evento === "texto") {
      resposta = String((dados as { texto?: unknown }).texto ?? "");
      registrar(caso, "atlas", resposta);
    }
    entrada.enviar(evento, dados);
  };

  // Mensagem curta sobre um caso aberto: o LLM diz se é um pedido ("usar a transcrição") ou um dado do lead.
  const curta = msg.trim().length > 0 && msg.trim().length <= MAX_INSTRUCAO;
  if (!arquivos.length && curta && caso.fontes.length) {
    const ins = await interpretarInstrucao(msg, caso, uso);
    if (ins && (ins.usarTranscricao || Object.keys(ins.ajustes).length)) {
      const partes: string[] = [];
      if (Object.keys(ins.ajustes).length) {
        if (!caso.lead) partes.push("Ainda não li a transcrição da R1, então não tenho onde anotar os dados do lead. Anexe a transcrição.");
        else {
          const antes = caso.lead;
          caso.ajustesLead = { ...caso.ajustesLead, ...ins.ajustes,
            objetivos: [...(caso.ajustesLead?.objetivos ?? []), ...(ins.ajustes.objetivos ?? [])] };
          caso.lead = aplicarAjustes(antes, ins.ajustes);
          for (const campo of ["primeiro_nome", "perfil", "objetivos"] as const)
            if (JSON.stringify(antes[campo]) !== JSON.stringify(caso.lead[campo]))
              caso.edicoes.push({ quando: Date.now(), campo: `lead.${campo}`, antes: antes[campo], depois: caso.lead[campo], origem: "assessor" });
          descartarRascunho(caso); // o rascunho depende do lead
          const dados = [ins.ajustes.primeiro_nome && `nome ${ins.ajustes.primeiro_nome}`, ins.ajustes.perfil && `perfil ${ins.ajustes.perfil}`,
            ins.ajustes.objetivos?.length && `objetivo${ins.ajustes.objetivos.length > 1 ? "s" : ""}: ${ins.ajustes.objetivos.join("; ")}`].filter(Boolean);
          partes.push(`Anotei no lead: ${dados.join(", ")}.`);
        }
      }
      if (ins.usarTranscricao) partes.push(await usarTranscricao(caso, uso, enviar, config));
      tocar(caso);
      enviar("texto", { texto: [...partes, resumoDoCaso(caso, [])].join("\n") });
      enviar("caso", publicoCaso(caso));
      return { texto: resposta };
    }
    // Pergunta sobre o caso, sem pedido de mudança: responde com o que já está no caso, sem alterá-lo.
    if (ins?.pergunta) {
      enviar("atividade", { pct: 30, msg: "Consultando o caso" });
      const r = await responderPergunta(caso, msg, uso);
      tocar(caso);
      enviar("texto", { texto: r });
      enviar("caso", publicoCaso(caso));
      return { texto: resposta };
    }
  }

  checarCancelado();
  let it;
  try { it = await interpretar(msg, arquivos, uso, {}, undefined, leitor); }
  catch (e) {
    if (e instanceof CanceladoError) throw e;
    throw new ErroDeTarefa(e instanceof Error ? e.message : "Erro ao ler os anexos.");
  }

  if (it.assessorInformado) caso.assessor = it.assessor;
  if (it.dataInformada) {
    const nova = it.dataR2.toISOString().slice(0, 10);
    if (nova !== caso.dataR2) descartarRascunho(caso); // a data entra no texto do rascunho
    caso.dataR2 = nova;
  }

  const novos: Fonte[] = [];
  const ignorados = [...it.ignorados];
  const avisosTriagem = it.avisos.map((a) => a.charAt(0).toUpperCase() + a.slice(1));
  for (const [papel, anexos] of [["carteira", it.carteiras], ["transcricao", it.transcricoes], ["contexto", it.contextos]] as const)
    for (const a of anexos) {
      const hash = hashTexto(a.texto ?? "");
      if (caso.fontes.some((f) => f.hash === hash)) { ignorados.push(`${a.nome} (já enviado nesta conversa)`); continue; }
      novos.push({ nome: a.nome, papel, origemPapel: "automatico", texto: a.texto ?? "", hash, tipo: it.detalhes[a.nome]?.tipo });
    }
  // Deck anterior ou anotações com posição só valem como carteira enquanto não há extrato, nem no caso nem neste envio.
  const chegouExtrato = novos.some((f) => f.papel === "carteira" && !eSubstituivel(f.tipo));
  for (const f of novos)
    if (f.papel === "carteira" && eSubstituivel(f.tipo) && (chegouExtrato || temExtrato(caso))) f.papel = "contexto";
  // nomes repetidos entre mensagens ficam distinguíveis
  for (const f of novos) if (caso.fontes.some((x) => x.nome === f.nome)) f.nome = `${f.nome} (${caso.fontes.length + 1})`;
  // A carteira real substitui a derivada. Transcrição nova deixa a derivada velha: sai também.
  const trocou = novos.length > 0 && removerDerivada(caso);
  caso.fontes.push(...novos);
  const rebaixadas = chegouExtrato ? rebaixarCarteirasSubstituiveis(caso) : [];
  const notaContexto = rebaixadas.length ? `\nChegou o extrato, então ${rebaixadas.map((n) => `"${n}"`).join(", ")} deixou de ser carteira e ficou só como contexto do lead.` : "";
  const nota0 = !trocou ? "" : "\n" + (novos.some((f) => f.papel === "carteira") ? "Troquei os valores citados na R1 pela carteira enviada."
    : "A transcrição mudou, então os valores citados na R1 saíram da carteira. Peça de novo para usar a transcrição.");
  const nota = nota0 + notaContexto;
  tocar(caso);

  if (!novos.length) {
    // Texto que não virou pedido, dado do lead, assessor ou data: o resumo de novo seria um loop. Diz o que dá para pedir.
    const naoEntendi = caso.fontes.length > 0 && !arquivos.length && !!msg.trim() && !it.assessorInformado && !it.dataInformada;
    const pr = prontidao(caso);
    const base = it.pergunta && !caso.fontes.length ? it.pergunta
      : naoEntendi ? NAO_ENTENDI + (pr.pronto ? "" : `\nPara gerar os slides ainda falta: ${pr.faltas.join("; ")}.`)
      : resumoDoCaso(caso, [], avisosTriagem);
    // `it.pergunta` (lib/chat.ts) já cita os ignorados; repetir a linha duplicaria a frase.
    const citaIgnorados = base === it.pergunta;
    enviar("texto", { texto: base + (ignorados.length && !citaIgnorados ? `\nNão usei: ${ignorados.join("; ")}.` : "") });
    enviar("caso", publicoCaso(caso));
    return { texto: resposta };
  }

  enviar("atividade", { pct: 5, msg: "Lendo os arquivos" });
  await leitura(caso, criarChatJson(uso), (_etapa, pct, m) => enviar("atividade", { pct, msg: m }), config);
  tocar(caso);
  const resumo = resumoDoCaso(caso, novos.map((f) => f.nome), avisosTriagem);
  enviar("texto", { texto: resumo + nota + (ignorados.length ? `\nNão usei: ${ignorados.join("; ")}.` : "") });
  enviar("caso", publicoCaso(caso));
  checarCancelado();
  return { texto: resposta };
}
