/**
 * Bedrock Runtime de mentira para os testes do consumidor: um servidor HTTP no processo do teste, ao qual o Worker chega por
 * BEDROCK_ENDPOINT. Responde ao Converse com as respostas gravadas de tests/fixtures/canned.json, conta as chamadas e as simultâneas
 * e deixa o teste atrasar ou falhar uma chamada. `usage.inputTokens` é o tamanho do corpo ÷ 3,5, para o teste conferir o medidor.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

const canned = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../fixtures/canned.json"), "utf-8")) as Record<string, unknown>;

const ATIVO_DERIVADO = { nome: "CDB", emissor: "a confirmar", classe: "Pós-fixado", subclasse: "Bancário com FGC", liquidez: "a confirmar",
  vencimento: "a confirmar", valor: 600000, fora_do_depara: false };

export interface ChamadaMock { schema: string; inputTokens: number }

export interface MockBedrock {
  url: string;
  chamadas: ChamadaMock[];
  /** Chamadas em andamento agora e o maior número delas ao mesmo tempo. */
  emAndamento: number;
  maxSimultaneas: number;
  /** Espera antes de responder (ms), para sobrepor execuções ou dar tempo de cancelar. */
  atrasoMs: number;
  /** Se devolver um status, a chamada falha com ele em vez de responder. */
  falhar?: (c: ChamadaMock, n: number) => number | null;
  /** Resposta da instrução (schema com `usar_transcricao`), a partir do texto da mensagem do assessor. */
  instrucao: (msg: string) => Record<string, unknown>;
  fechar(): Promise<void>;
  zerar(): void;
}

function responder(nome: string, props: Record<string, unknown>, corpo: string, usuario: string, instrucao: MockBedrock["instrucao"]): unknown {
  if (nome === "AtivosOut" && corpo.includes("O LEAD diz ter hoje")) return { ativos: [ATIVO_DERIVADO], data_posicao: "" };
  if (nome !== "Resposta") return canned[nome];
  if ("usar_transcricao" in props) return instrucao(usuario.split("MENSAGEM:\n").pop() ?? "");
  if ("resposta" in props) return { resposta: "Resposta do mock sobre o caso.", fontes: ["lead"] };
  if ("classificacoes" in props) return { classificacoes: [] };
  return { ok: true };
}

export async function iniciarMockBedrock(): Promise<MockBedrock> {
  const instrucaoPadrao: MockBedrock["instrucao"] = (msg) =>
    ({ usar_transcricao: /usa.*transcri/i.test(msg), primeiro_nome: "", perfil: "", objetivos: [], pergunta: msg.includes("?") });
  const m: MockBedrock = {
    url: "", chamadas: [], emAndamento: 0, maxSimultaneas: 0, atrasoMs: 0, instrucao: instrucaoPadrao,
    async fechar() { await new Promise<void>((r) => { servidor.closeAllConnections(); servidor.close(() => r()); }); },
    zerar() { m.chamadas = []; m.maxSimultaneas = 0; m.atrasoMs = 0; m.falhar = undefined; m.instrucao = instrucaoPadrao; },
  };
  const servidor = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", async () => {
      const b = JSON.parse(corpo || "{}");
      const js = b.outputConfig?.textFormat?.structure?.jsonSchema as { name: string; schema: string } | undefined;
      const schema = js?.name ?? "imagem";
      const props = js ? (JSON.parse(js.schema).properties ?? {}) : {};
      const chamada: ChamadaMock = { schema: js?.name === "Resposta" ? `Resposta:${Object.keys(props)[0]}` : schema, inputTokens: Math.ceil(corpo.length / 3.5) };
      m.chamadas.push(chamada);
      m.emAndamento++;
      m.maxSimultaneas = Math.max(m.maxSimultaneas, m.emAndamento);
      try {
        if (m.atrasoMs) await new Promise((r) => setTimeout(r, m.atrasoMs));
        const status = m.falhar?.(chamada, m.chamadas.length);
        if (status) { res.writeHead(status, { "content-type": "application/json" }); return res.end(JSON.stringify({ message: "falha simulada" })); }
        const dados = js ? responder(js.name, props, corpo, String(b.messages?.[0]?.content?.[0]?.text ?? ""), m.instrucao) : "| CDB DI | 729.546,02 |";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          output: { message: { role: "assistant", content: [{ text: typeof dados === "string" ? dados : JSON.stringify(dados) }] } },
          stopReason: "end_turn", usage: { inputTokens: chamada.inputTokens, outputTokens: 300 },
        }));
      } finally { m.emAndamento--; }
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  m.url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  return m;
}
