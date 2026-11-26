import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIANCA_MINIMA, classificarPorConteudo, classificarPorNome, triar } from "../lib/classificacao";

// Texto de um extrato de verdade (o gerado em ~/SKILLS/r2/mocks), encurtado.
const EXTRATO = `
POSICAO CONSOLIDADA DE INVESTIMENTOS
Cliente RAFAEL ANDRADE BITTENCOURT
Periodo 01/08/2026 a 31/08/2026
ATIVO INSTITUICAO VEICULO VENCIMENTO LIQUIDEZ VALOR (R$)
Tesouro Selic 2029 (LFT) BTG Pactual Titulo Publico 01/03/2029 D+1 320.000,00
CDB BTG Pactual 103% CDI BTG Pactual Bancario 15/07/2028 No venc. 450.000,00
LCI BTG Pactual 97% CDI BTG Pactual Bancario 20/02/2028 No venc. 380.000,00
Tesouro IPCA+ 2035 Juros Semestrais BTG Pactual Titulo Publico 15/05/2035 295.400,00
Debenture Inc. Eletrobras ELET26 BTG Pactual Cred. Privado 210.000,00
CSHG Logistica FII - HGLG11 BTG Pactual Imobiliario D+2 168.300,00
PATRIMONIO TOTAL CONSOLIDADO EM REAIS 4.579.850,00
`;

const TRANSCRICAO_VTT = `WEBVTT

00:00:01.000 --> 00:00:04.500
Assessor: Bom dia, Carmen. Tudo bem com a senhora?

00:00:04.800 --> 00:00:09.200
Carmen: Tudo ótimo, obrigada. Vamos falar sobre os investimentos?
`;

// O caso que motivou tudo: transcrição em texto puro, sem nenhum cue.
const TRANSCRICAO_TXT = `
Assessor: Bom dia, Carmen. Como a senhora está?
Carmen: Estou bem. Queria entender melhor aquele fundo que você comentou.
Assessor: Claro. Ele é de renda fixa e hoje rende um pouco acima do CDI.
Carmen: E o resgate, como funciona?
Assessor: O resgate é em D+30, então vale planejar antes de precisar do dinheiro.
Carmen: Entendi. E sobre o imóvel, já conversei com a incorporadora.
Assessor: Perfeito. Quando fechar, a gente senta para repensar a alocação.
Carmen: Combinado. Pode me mandar o material por e-mail?
Assessor: Mando hoje ainda. Qualquer dúvida é só chamar.
Carmen: Obrigada, até mais.
Assessor: Até mais, bom dia.
`;

describe("classificarPorConteudo", () => {
  it("reconhece extrato por valores, produtos e vocabulário de custódia", () => {
    const c = classificarPorConteudo(EXTRATO);
    expect(c.papel).toBe("carteira");
    expect(c.confianca).toBeGreaterThanOrEqual(CONFIANCA_MINIMA);
  });

  it("cue de legenda decide sozinho, com confiança total", () => {
    const c = classificarPorConteudo(TRANSCRICAO_VTT);
    expect(c).toMatchObject({ papel: "transcricao", confianca: 1 });
    expect(c.sinais).toContain("cue_de_legenda");
  });

  it("reconhece transcrição em texto puro pelo padrão de fala", () => {
    const c = classificarPorConteudo(TRANSCRICAO_TXT);
    expect(c.papel).toBe("transcricao");
    expect(c.confianca).toBeGreaterThanOrEqual(CONFIANCA_MINIMA);
  });

  // Transcrição de R2 exportada em .docx: cada fala começa com o horário, e
  // a conversa é sobre a carteira (cita produtos). Antes o horário escondia
  // as falas e os produtos citados faziam dela um "extrato".
  it("reconhece fala com timestamp antes do nome, mesmo citando produtos", () => {
    const falas = [
      "[00:00:12] Marina: Boa noite, Ana. Hoje vamos falar da sua carteira.",
      "[00:00:31] Ana: Pode sim. Tenho CDB, LCI e um pouco de Tesouro Selic.",
      "[00:00:40] Marina: O CDB vence em 2028, a LCI tem liquidez no vencimento.",
      "[00:01:05] Ana: E a debênture? Comprei pela custódia do outro banco.",
      "(00:01:20) Marina: A debênture é incentivada, renda fixa isenta.",
      "00:01:42 - Ana: Entendi. E o FII e o ETF que eu tenho?",
    ];
    const texto = Array.from({ length: 3 }, () => falas.join("\n\n")).join("\n\n");
    const c = classificarPorConteudo(texto);
    expect(c.papel).toBe("transcricao");
    expect(c.confianca).toBeGreaterThanOrEqual(CONFIANCA_MINIMA);
  });

  it("texto sem sinal nenhum não decide nada (confiança 0)", () => {
    const c = classificarPorConteudo("Olá.\nTudo certo por aqui.\n");
    expect(c.confianca).toBe(0);
    expect(c.sinais).toContain("sem_sinal");
  });
});

describe("classificarPorNome", () => {
  it("lê o nome de um extrato exportado em .docx", () => {
    const c = classificarPorNome("Extrato_XP_01-2026.docx");

    expect(c?.papel).toBe("carteira");
    expect(c?.sinais).toEqual(["nome:carteira"]);
  });

  it("lê o nome de uma transcrição", () => {
    expect(classificarPorNome("Reuniao Carmen 12-11.docx")?.papel).toBe("transcricao");
    expect(classificarPorNome("transcricao-r1.txt")?.papel).toBe("transcricao");
    expect(classificarPorNome("Call com cliente.vtt")?.papel).toBe("transcricao");
  });

  it("ignora acento, separador e sufixo de cópia", () => {
    expect(classificarPorNome("Posição Consolidada (1).pdf")?.papel).toBe("carteira");
  });

  // Palavra curta dentro de outra é o jeito mais fácil de inverter a decisão.
  it("não casa palavra curta dentro de outra palavra", () => {
    expect(classificarPorNome("experiencia do cliente.docx")).toBeNull();
    expect(classificarPorNome("plataforma.docx")).toBeNull();
    expect(classificarPorNome("relatorio internacional.docx")).toBeNull();
  });

  it("devolve null quando o nome não diz nada ou diz as duas coisas", () => {
    expect(classificarPorNome("documento-01.docx")).toBeNull();
    expect(classificarPorNome("scan_2026_11_12.pdf")).toBeNull();
    expect(classificarPorNome("extrato citado na reuniao.docx")).toBeNull();
  });

  // A extensão não pode virar palavra: ".ata" não existe, mas ".doc" e afins
  // entrariam na conta se o sufixo não saísse antes.
  it("não considera a extensão como palavra do nome", () => {
    expect(classificarPorNome("cliente.ata")).toBeNull();
  });
});

describe("triar (escada conteúdo, nome, extensão)", () => {
  it("conteúdo vence nome e extensão (extrato em .docx)", () => {
    const r = triar({ nome: "reuniao.docx", texto: EXTRATO, palpiteDaExtensao: "transcricao" });
    expect(r).toMatchObject({ papel: "carteira", origem: "conteudo", incerto: false });
  });
  it("conteúdo fraco: o nome desempata sem perguntar", () => {
    const r = triar({ nome: "Extrato XP.docx", texto: "Olá.\nTudo certo.", palpiteDaExtensao: "transcricao" });
    expect(r).toMatchObject({ papel: "carteira", origem: "nome", incerto: false });
  });
  it("leitura ambígua e nome mudo: fica a extensão e marca incerto", () => {
    const r = triar({ nome: "doc1.docx", texto: "Olá.\nTudo certo.", palpiteDaExtensao: "transcricao" });
    expect(r).toMatchObject({ papel: "transcricao", origem: "extensao", incerto: true });
  });
  it("sem texto e sem nome: palpite da extensão, sem perguntar", () => {
    const r = triar({ nome: "scan.pdf", texto: null, palpiteDaExtensao: "carteira" });
    expect(r).toMatchObject({ papel: "carteira", origem: "sem_leitura", incerto: false });
  });
});

describe("transcrição com horário na linha do nome (Teams/Meet)", () => {
  it("reconhece 'Nome   0:08' mesmo citando produtos", () => {
    const bloco = "Luiz Eduardo   0:08\nVamos falar do seu CDB e da LCI, custódia e vencimento.\n\nElisandro Silveira   0:09\nOkay, e o Tesouro Selic?\n\n";
    const c = classificarPorConteudo(bloco.repeat(6));
    expect(c.papel).toBe("transcricao");
    expect(c.confianca).toBeGreaterThanOrEqual(CONFIANCA_MINIMA);
  });
});

// Export .docx do Teams lido pelo mammoth: o horário vem colado na fala ("Nome   0:08Fala").
// O texto real de 06/11 foi classificado como carteira (confiança 1, 0 falas) e trocou os papéis.
describe("transcrição .docx com horário colado na fala (caso Elisandro)", () => {
  const docx = fs.readFileSync(path.join(__dirname, "fixtures", "transcricao_elisandro_docx.txt"), "utf8");

  it("conta as falas e classifica como transcrição", () => {
    const c = classificarPorConteudo(docx);
    expect(c.papel).toBe("transcricao");
    expect(c.confianca).toBeGreaterThanOrEqual(CONFIANCA_MINIMA);
    expect(Number(c.sinais.find((s) => s.startsWith("falas:"))?.split(":")[1] ?? 0)).toBeGreaterThan(50);
  });

  it("triar mantém transcrição, venha o palpite da extensão que vier", () => {
    const r = triar({ nome: "Reunião com Luiz Eduardo (60).docx", texto: docx, palpiteDaExtensao: "carteira" });
    expect(r).toMatchObject({ papel: "transcricao", origem: "conteudo" });
  });
});

describe("texto sem valor em R$ com centavos não vira extrato só por citar produtos", () => {
  const conversa = "Eu tenho CDB e LCI, com vencimento em 2029. A liquidez é no vencimento. Renda fixa, custódia e aplicação.\n".repeat(4);

  it("fica abaixo da confiança mínima (o nome do arquivo decide)", () => {
    const c = classificarPorConteudo(conversa);
    expect(c.confianca).toBeLessThan(CONFIANCA_MINIMA);
  });

  it("nome 'Reunião' decide quando o conteúdo é fraco", () => {
    const r = triar({ nome: "Reunião com Fulano.docx", texto: conversa, palpiteDaExtensao: "carteira" });
    expect(r).toMatchObject({ papel: "transcricao", origem: "nome" });
  });
});
