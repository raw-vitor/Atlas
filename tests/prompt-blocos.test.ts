/** Catálogo de blocos do prompt: paridade com o prompt original, montagem com config, validação e resumo. */
import { describe, expect, it } from "vitest";
import { kb } from "../lib/knowledge";
import {
  BLOCOS, CATEGORIAS_INFO, KB_DA_ETAPA, montarSistemaResumo, textoPapel, textoTarefa, validarConfig,
} from "../lib/prompt-blocos";
import { montarSistema, tamanhoKb } from "../lib/prompt-montagem";
import * as atuais from "../lib/prompts";
import * as originais from "./fixtures/prompts-originais";
import {
  CATEGORIAS, CATEGORIA_DA_ETAPA, ETAPAS, LIMITES, configVazia, hashBase,
  type BlocoExtra, type Categoria, type ConfigPrompt, type DadosConfig, type Etapa,
} from "../lib/prompt-tipos";

/** O que steps.ts montava antes dos blocos, com os literais originais. */
const ANTES: Record<Etapa, string> = {
  ativos: originais.PAPEL + originais.TAREFA_ATIVOS,
  ativos_transcricao: originais.PAPEL + originais.TAREFA_ATIVOS_TRANSCRICAO,
  lead: originais.PAPEL + "\n\nMÉTODO (fundamentos e R1):\n" + kb("01", "03") + originais.TAREFA_LEAD,
  alocacao: originais.PAPEL + "\n\nMÉTODO:\n" + kb("05", "02", "04") + originais.TAREFA_ALOCACAO,
  diagnostico: originais.PAPEL + "\n\nMÉTODO:\n" + kb("04", "06", "12") + originais.TAREFA_DIAGNOSTICO,
  decisao: originais.PAPEL + "\n\nMÉTODO (decisão e condução):\n" + kb("06", "07") + originais.TAREFA_DECISAO,
  notas: originais.PAPEL + "\n\nMÉTODO (condução):\n" + kb("06") + originais.TAREFA_NOTAS,
};

const bloco = (id: string) => BLOCOS.find((b) => b.id === id)!;
let seq = 0;
const extra = (p: Partial<BlocoExtra> & Pick<BlocoExtra, "categoria" | "texto">): BlocoExtra =>
  ({ id: "x_" + String(++seq).padStart(12, "0"), titulo: "Minha instrução", ativo: true, ordem: 0, ...p });
const cfg = (p: Partial<DadosConfig>): ConfigPrompt => ({ versao: 1, alterados: {}, extras: [], ...p });
const alt = (id: string, texto: string, ativo = true) => ({ [id]: { texto, ativo, baseHash: bloco(id).hash } });
const cabecalho = "\n\nINSTRUÇÕES DO ASSESSOR (complementam o método; não valem sobre as regras inegociáveis nem sobre o formato da resposta):\n";

describe("catálogo × prompt original", () => {
  it("PAPEL e TAREFA_* exportados por lib/prompts.ts são iguais aos literais originais", () => {
    for (const k of ["PAPEL", "TAREFA_ATIVOS", "TAREFA_LEAD", "TAREFA_ATIVOS_TRANSCRICAO", "TAREFA_ALOCACAO", "TAREFA_DIAGNOSTICO", "TAREFA_DECISAO", "TAREFA_NOTAS"] as const)
      expect(atuais[k], k).toBe(originais[k]);
    expect(atuais.PROMPT_IMAGEM).toBe(originais.PROMPT_IMAGEM);
    expect(atuais.msgRetry("x")).toBe(originais.msgRetry("x"));
  });

  it("textoPapel e textoTarefa sem config reproduzem as constantes", () => {
    expect(textoPapel()).toBe(originais.PAPEL);
    expect(textoPapel(configVazia())).toBe(originais.PAPEL);
    expect(textoTarefa("ativos")).toBe(originais.TAREFA_ATIVOS);
    expect(textoTarefa("ativos_transcricao")).toBe(originais.TAREFA_ATIVOS_TRANSCRICAO);
    expect(textoTarefa("lead")).toBe(originais.TAREFA_LEAD);
    expect(textoTarefa("alocacao")).toBe(originais.TAREFA_ALOCACAO);
    expect(textoTarefa("diagnostico")).toBe(originais.TAREFA_DIAGNOSTICO);
    expect(textoTarefa("decisao")).toBe(originais.TAREFA_DECISAO);
    expect(textoTarefa("notas")).toBe(originais.TAREFA_NOTAS);
  });

  it("os miolos dos blocos, na ordem, cobrem as constantes: o que sobra são só separadores", () => {
    const todos = [originais.PAPEL, originais.TAREFA_ATIVOS, originais.TAREFA_ATIVOS_TRANSCRICAO, originais.TAREFA_LEAD,
      originais.TAREFA_ALOCACAO, originais.TAREFA_DIAGNOSTICO, originais.TAREFA_DECISAO, originais.TAREFA_NOTAS];
    let achados = 0;
    for (const c of todos) {
      let resto = c, de = 0;
      for (const b of BLOCOS) {
        const i = c.indexOf(b.texto, de);
        if (i < 0) continue;
        de = i + b.texto.length; achados++;
        resto = resto.replace(b.texto, "");
      }
      expect(resto).toMatch(/^[\s,]*$/);
    }
    expect(achados).toBe(BLOCOS.length);
  });

  it("montarSistema sem config e com config vazia é o prompt de antes em todas as etapas", () => {
    for (const e of ETAPAS) {
      expect(montarSistema(e), e).toBe(ANTES[e]);
      expect(montarSistema(e, configVazia()), e).toBe(ANTES[e]);
      expect(montarSistema(e, configVazia(7)), e).toBe(ANTES[e]);
    }
  });

  it("alterado igual ao original, ou extra desligado, não muda nada", () => {
    const c = cfg({
      alterados: Object.fromEntries(BLOCOS.filter((b) => !b.travado).map((b) => [b.id, { texto: b.texto, ativo: true, baseHash: b.hash }])),
      extras: [extra({ categoria: "geral", texto: "desligada", ativo: false })],
    });
    for (const e of ETAPAS) expect(montarSistema(e, c), e).toBe(ANTES[e]);
  });

  it("cada bloco tem hash do texto, ajuda sem jargão e cabe no limite de edição", () => {
    const ids = new Set<string>();
    for (const b of BLOCOS) {
      expect(ids.has(b.id), `id repetido ${b.id}`).toBe(false);
      ids.add(b.id);
      expect(b.hash).toBe(hashBase(b.texto));
      expect(b.texto).toBe(b.texto.trim());
      expect(b.texto.length, b.id).toBeLessThanOrEqual(LIMITES.textoBloco);
      expect(b.titulo.length, b.id).toBeLessThanOrEqual(LIMITES.tituloBloco);
      expect(CATEGORIAS).toContain(b.categoria);
      expect(`${b.titulo} ${b.ajuda}`).not.toMatch(/system prompt|schema|json/i);
    }
  });

  it("só o bloco de compliance é travado", () => {
    expect(BLOCOS.filter((b) => b.travado).map((b) => b.id)).toEqual(["geral.compliance"]);
    expect(bloco("geral.compliance").texto).toContain("nunca prometa rentabilidade");
  });

  it("categorias na ordem de CATEGORIAS, com título, descrição, slides e referência", () => {
    expect(CATEGORIAS_INFO.map((c) => c.id)).toEqual([...CATEGORIAS]);
    for (const c of CATEGORIAS_INFO) {
      expect(c.titulo && c.descricao && c.slides.length).toBeTruthy();
      expect(`${c.descricao}`).not.toMatch(/system prompt|schema/i);
    }
    const ref = (c: Categoria) => CATEGORIAS_INFO.find((x) => x.id === c)!.referencia;
    expect(ref("geral")).toEqual([]);
    expect(ref("carteira")).toEqual([]);
    expect(ref("diagnostico")).toEqual(["04 Diagnóstico da carteira", "06 R2 condução e pós-reunião", "12 Aprendizados"]);
    expect(ref("proposta")).toHaveLength(3);
    // todo bloco pertence a uma categoria com etapa que o usa
    for (const b of BLOCOS.filter((x) => x.categoria !== "geral")) expect(Object.values(CATEGORIA_DA_ETAPA)).toContain(b.categoria);
  });

  it("KB_DA_ETAPA bate com os arquivos que kb() recebe (a base existe para todos)", () => {
    for (const e of ETAPAS) for (const a of KB_DA_ETAPA[e]?.arquivos ?? []) expect(kb(a).length, `${e}:${a}`).toBeGreaterThan(0);
    expect(KB_DA_ETAPA.ativos).toBeNull();
    expect(KB_DA_ETAPA.ativos_transcricao).toBeNull();
  });
});

describe("montarSistema com config", () => {
  it("bloco alterado usa o texto do assessor e mantém os separadores", () => {
    const c = cfg({ alterados: alt("geral.tom", "Escreva de forma formal.") });
    const s = montarSistema("diagnostico", c);
    expect(s).toContain("EQI Investimentos e segue o Método Hunter v5.8. Escreva de forma formal. Regras inegociáveis:");
    expect(s).not.toContain("com frases curtas");
    expect(s).toBe(ANTES.diagnostico.replace(bloco("geral.tom").texto, "Escreva de forma formal."));
  });

  it("alteração em bloco de tarefa vale só nas etapas dele", () => {
    const c = cfg({ alterados: alt("carteira.ignorar", "Ignore totais.") });
    expect(montarSistema("ativos", c)).toBe(ANTES.ativos.replace(bloco("carteira.ignorar").texto, "Ignore totais."));
    expect(montarSistema("ativos_transcricao", c)).toBe(ANTES.ativos_transcricao);
    expect(montarSistema("lead", c)).toBe(ANTES.lead);
  });

  it("os blocos de carteira formam a TAREFA certa de cada etapa", () => {
    const c = cfg({ alterados: alt("carteira.transcricao", "Liste só o que o lead disse.") });
    expect(montarSistema("ativos", c)).toBe(ANTES.ativos);
    expect(montarSistema("ativos_transcricao", c)).toBe(ANTES.ativos_transcricao.replace(bloco("carteira.transcricao").texto, "Liste só o que o lead disse."));
  });

  it("o bloco geral alterado vale em todas as etapas", () => {
    const c = cfg({ alterados: alt("geral.limites", "Frases curtas.") });
    for (const e of ETAPAS) {
      expect(montarSistema(e, c), e).toBe(ANTES[e].replace(bloco("geral.limites").texto, "Frases curtas."));
      expect(montarSistema(e, c)).toContain("Frases curtas.");
    }
  });

  it("texto do assessor é aparado e vazio cai no original", () => {
    expect(montarSistema("notas", cfg({ alterados: alt("notas.tamanho", "  Cada nota tem 3 linhas.\n\n") })))
      .toBe(ANTES.notas.replace(bloco("notas.tamanho").texto, "Cada nota tem 3 linhas."));
    expect(montarSistema("notas", cfg({ alterados: alt("notas.tamanho", "   ") }))).toBe(ANTES.notas);
  });

  it("bloco desligado sai e a junção continua legível", () => {
    const sem = (id: string, e: Etapa) => montarSistema(e, cfg({ alterados: alt(id, bloco(id).texto, false) }));
    // do meio da PAPEL
    expect(sem("geral.tom", "ativos")).toBe(ANTES.ativos.replace(bloco("geral.tom").texto + " ", ""));
    // primeiro bloco da TAREFA: o "\n\nTarefa" inicial é da entrada do grupo e é mantido
    const s = sem("decisao.decisao", "decisao");
    expect(s).toContain(kb("06", "07") + "\n\no Resumo (6 itens");
    expect(s).not.toContain("slide A Decisão,");
    // primeiro bloco do PAPEL
    expect(sem("geral.identidade", "decisao").startsWith("Escreva em português do Brasil")).toBe(true);
    // último bloco do PAPEL: sem espaço sobrando antes do método
    expect(sem("geral.perguntas", "lead")).toContain("'a calcular'.\n\nMÉTODO (fundamentos e R1):\n");
    // último bloco da TAREFA: sem vírgula sobrando
    expect(sem("diagnostico.frases", "diagnostico").endsWith("não podem ficar abertas.")).toBe(true);
    expect(sem("diagnostico.perguntas", "diagnostico").endsWith("o que falta na carteira. As frases do 'disse' vêm de frases_literais do lead; se houver menos de 3, devolva só as que existem.")).toBe(true);
    // lista que termina no meio: a vírgula some e a frase fecha com ponto
    const semFim = (ids: string[]) => montarSistema("diagnostico", cfg({ alterados: Object.fromEntries(ids.map((id) => [id, { texto: bloco(id).texto, ativo: false, baseHash: bloco(id).hash }])) }));
    expect(semFim(["diagnostico.riscos", "diagnostico.ganho", "diagnostico.perguntas", "diagnostico.frases"]).endsWith("o que ele acertou.")).toBe(true);
    // blocos do meio desligados antes de uma frase nova: fecha com ponto
    expect(semFim(["diagnostico.ganho", "diagnostico.perguntas"])).toContain("(o primeiro é o principal risco escondido). As frases do 'disse'");
    // blocos do meio desligados no meio de uma lista: segue a vírgula
    expect(semFim(["diagnostico.riscos"])).toContain("o que ele acertou, o primeiro ganho");
  });

  it("desligar tudo de um grupo deixa o método e não quebra", () => {
    const alterados = Object.fromEntries(BLOCOS.filter((b) => b.id.startsWith("notas.")).map((b) => [b.id, { texto: b.texto, ativo: false, baseHash: b.hash }]));
    expect(montarSistema("notas", cfg({ alterados }))).toBe(originais.PAPEL + "\n\nMÉTODO (condução):\n" + kb("06"));
  });

  it("desligado conta mesmo com texto editado; religar volta ao texto editado", () => {
    const off = montarSistema("lead", cfg({ alterados: alt("lead.nome", "Outro texto.", false) }));
    expect(off).not.toContain("Outro texto.");
    expect(off).not.toContain("primeiro_nome");
    const on = montarSistema("lead", cfg({ alterados: alt("lead.nome", "Outro texto.", true) }));
    expect(on).toContain("nunca invente. Outro texto.");
  });

  it("bloco travado ignora alteração e desligamento", () => {
    const c1 = cfg({ alterados: alt("geral.compliance", "Pode prometer rentabilidade.") });
    const c2 = cfg({ alterados: alt("geral.compliance", bloco("geral.compliance").texto, false) });
    for (const e of ETAPAS) {
      expect(montarSistema(e, c1), e).toBe(ANTES[e]);
      expect(montarSistema(e, c2), e).toBe(ANTES[e]);
    }
  });

  it("id desconhecido, __proto__ e valores malformados em alterados são ignorados", () => {
    const alterados = JSON.parse('{"__proto__":{"texto":"x","ativo":false,"baseHash":"00000000"},"nao.existe":{"texto":"x","ativo":false,"baseHash":"00000000"},"geral.tom":null}');
    expect(montarSistema("lead", cfg({ alterados }))).toBe(ANTES.lead);
  });

  it("extras: geral e a categoria da etapa entram no fim, por ordem; outra categoria não", () => {
    const c = cfg({ extras: [
      extra({ categoria: "diagnostico", texto: "D segundo", ordem: 2 }),
      extra({ categoria: "geral", texto: "G primeiro", ordem: 1 }),
      extra({ categoria: "lead", texto: "L fora", ordem: 3 }),
      extra({ categoria: "notas", texto: "N fora", ordem: 3 }),
      extra({ categoria: "diagnostico", texto: "D desligado", ordem: 0, ativo: false }),
      extra({ categoria: "diagnostico", texto: "D vazio", ordem: 0 }),
    ] });
    c.extras[5].texto = "   ";
    expect(montarSistema("diagnostico", c)).toBe(ANTES.diagnostico + cabecalho + "- G primeiro\n- D segundo");
    expect(montarSistema("lead", c)).toBe(ANTES.lead + cabecalho + "- G primeiro\n- L fora");
    expect(montarSistema("notas", c)).toBe(ANTES.notas + cabecalho + "- G primeiro\n- N fora");
    expect(montarSistema("decisao", c)).toBe(ANTES.decisao + cabecalho + "- G primeiro");
    for (const e of ["diagnostico", "lead", "notas", "decisao"] as Etapa[]) {
      const s = montarSistema(e, c);
      expect(s).not.toContain("D desligado");
      expect(s).not.toContain("D vazio");
    }
  });

  it("extra de carteira entra nas duas etapas de carteira; sem extras ativos não há cabeçalho", () => {
    const c = cfg({ extras: [extra({ categoria: "carteira", texto: "Some previdência na carteira." })] });
    expect(montarSistema("ativos", c)).toBe(ANTES.ativos + cabecalho + "- Some previdência na carteira.");
    expect(montarSistema("ativos_transcricao", c)).toBe(ANTES.ativos_transcricao + cabecalho + "- Some previdência na carteira.");
    expect(montarSistema("alocacao", c)).toBe(ANTES.alocacao);
    expect(montarSistema("alocacao", cfg({ extras: [extra({ categoria: "geral", texto: "x", ativo: false })] }))).not.toContain("INSTRUÇÕES DO ASSESSOR");
  });

  it("empate de ordem mantém a ordem do array; texto com quebra de linha é indentado", () => {
    const c = cfg({ extras: [extra({ categoria: "geral", texto: "A\nB", ordem: 5 }), extra({ categoria: "proposta", texto: "C", ordem: 5 })] });
    expect(montarSistema("alocacao", c)).toBe(ANTES.alocacao + cabecalho + "- A\n  B\n- C");
  });

  it("alterado e extra juntos; o extra fica depois da tarefa", () => {
    const c = cfg({ alterados: alt("proposta.fases", "Exatamente 3 fases."), extras: [extra({ categoria: "proposta", texto: "Prefira prazos curtos." })] });
    const s = montarSistema("alocacao", c);
    expect(s).toBe(ANTES.alocacao.replace(bloco("proposta.fases").texto, "Exatamente 3 fases.") + cabecalho + "- Prefira prazos curtos.");
    expect(s.indexOf("Exatamente 3 fases.")).toBeLessThan(s.indexOf("INSTRUÇÕES DO ASSESSOR"));
  });

  it("a config não é alterada nem compartilha estado entre chamadas", () => {
    const c = cfg({ alterados: alt("geral.tom", "X."), extras: [extra({ categoria: "geral", texto: "Y", ordem: 2 }), extra({ categoria: "geral", texto: "Z", ordem: 1 })] });
    const copia = structuredClone(c);
    const a = montarSistema("lead", c);
    expect(c).toEqual(copia);
    expect(montarSistema("lead", c)).toBe(a);
    expect(montarSistema("lead")).toBe(ANTES.lead);
  });
});

describe("montarSistemaResumo", () => {
  const juntar = (ts: { texto: string }[]) => ts.map((t) => t.texto).join("");

  it("sem config: tudo original, base trocada pelo marcador, sem número", () => {
    const r = montarSistemaResumo("diagnostico");
    expect(r.every((t) => t.origem === "original")).toBe(true);
    expect(juntar(r)).toBe(ANTES.diagnostico.replace(kb("04", "06", "12"), "[Método Hunter: 04, 06, 12]"));
    expect(juntar(r)).not.toContain("=====");
  });

  it("com tamanho da base, mostra o número com separador de milhar", () => {
    expect(juntar(montarSistemaResumo("notas", undefined, 52341))).toContain("[Método Hunter: 06 · 52.341 caracteres]");
    expect(tamanhoKb("notas")).toBe(kb("06").length);
    expect(tamanhoKb("ativos")).toBe(0);
    expect(juntar(montarSistemaResumo("ativos", undefined, 123))).toBe(ANTES.ativos);
  });

  it("trocando o marcador pela base, o resumo é exatamente montarSistema (com config)", () => {
    const c = cfg({ alterados: { ...alt("geral.tom", "Seja formal."), ...alt("diagnostico.riscos", "os 3 riscos", true), ...alt("diagnostico.frases", "x", false) },
      extras: [extra({ categoria: "geral", texto: "G" }), extra({ categoria: "diagnostico", texto: "D\nlinha 2", ordem: 3 })] });
    for (const e of ETAPAS) {
      const base = KB_DA_ETAPA[e];
      const r = juntar(montarSistemaResumo(e, c)).replace(`[Método Hunter: ${base?.arquivos.join(", ")}]`, base ? kb(...base.arquivos) : "");
      expect(r, e).toBe(montarSistema(e, c));
    }
  });

  it("marca como assessor só o que veio dele: blocos editados e extras", () => {
    const c = cfg({ alterados: alt("geral.tom", "Seja formal."), extras: [extra({ categoria: "diagnostico", texto: "Cite o prazo." })] });
    const r = montarSistemaResumo("diagnostico", c);
    const doAssessor = r.filter((t) => t.origem === "assessor").map((t) => t.texto);
    expect(doAssessor).toEqual(["Seja formal.", "Cite o prazo."]);
    // trechos vizinhos de mesma origem são juntos
    r.forEach((t, i) => { if (i) expect(t.origem === r[i - 1].origem).toBe(false); });
    // o cabeçalho das instruções e o marcador da base são do original
    expect(r.find((t) => t.texto.includes("INSTRUÇÕES DO ASSESSOR"))!.origem).toBe("original");
    expect(r.find((t) => t.texto.includes("[Método Hunter"))!.origem).toBe("original");
  });

  it("bloco desligado ou editado igual ao original não marca assessor; travado nunca", () => {
    const c = cfg({ alterados: { ...alt("geral.tom", bloco("geral.tom").texto), ...alt("geral.numeros", "qualquer", false), ...alt("geral.compliance", "livre") } });
    expect(montarSistemaResumo("lead", c).some((t) => t.origem === "assessor")).toBe(false);
  });
});

describe("validarConfig", () => {
  const ok = (corpo: unknown) => {
    const r = validarConfig(corpo);
    if (!r.ok) throw new Error(r.erro);
    return r.dados;
  };
  const erro = (corpo: unknown) => {
    const r = validarConfig(corpo);
    if (r.ok) throw new Error("devia falhar");
    return r.erro;
  };
  const novoExtra = (p: Partial<BlocoExtra> = {}): BlocoExtra => extra({ categoria: "geral", texto: "Texto", ...p });

  it("config vazia e corpo mínimo são válidos; versao é ignorada", () => {
    expect(ok({})).toEqual({ alterados: {}, extras: [] });
    expect(ok({ versao: 3, alterados: {}, extras: [] })).toEqual({ alterados: {}, extras: [] });
  });

  it("corpo que não é objeto ou com formato errado", () => {
    for (const c of [null, undefined, "x", 3, [], { alterados: [] }, { alterados: null }, { extras: {} }, { extras: "x" }])
      expect(erro(c), JSON.stringify(c)).toMatch(/inválida/);
  });

  it("alterado: aceita, apara, normaliza quebras e remove caracteres de controle (menos \\n e \\t)", () => {
    const d = ok({ alterados: alt("geral.tom", "  linha1\r\nlin\u0000ha\u0007 2\tcom tab\u007f  ") });
    expect(d.alterados["geral.tom"]).toEqual({ texto: "linha1\nlinha 2\tcom tab", ativo: true, baseHash: bloco("geral.tom").hash });
  });

  it("alterado: vazio não pode, nem só com espaços ou controle", () => {
    for (const t of ["", "   ", "\n\t", "\u0000\u0001"]) expect(erro({ alterados: alt("geral.tom", t) })).toMatch(/não pode ficar vazio.*desligue/);
  });

  it("alterado: limite de 1.500 caracteres", () => {
    expect(ok({ alterados: alt("geral.tom", "a".repeat(LIMITES.textoBloco)) }).alterados["geral.tom"].texto).toHaveLength(LIMITES.textoBloco);
    expect(erro({ alterados: alt("geral.tom", "a".repeat(LIMITES.textoBloco + 1)) })).toMatch(/Tom e linguagem.*1\.501.*1\.500/);
    // o limite vale depois do trim
    expect(ok({ alterados: alt("geral.tom", "  " + "a".repeat(LIMITES.textoBloco) + "  ") }).alterados["geral.tom"].texto).toHaveLength(LIMITES.textoBloco);
  });

  it("alterado: id inexistente, incluindo __proto__ e constructor", () => {
    expect(erro({ alterados: { "nao.existe": { texto: "x", ativo: true, baseHash: "00000000" } } })).toMatch(/não existe/);
    expect(erro(JSON.parse('{"alterados":{"__proto__":{"texto":"x","ativo":true,"baseHash":"00000000"}}}'))).toMatch(/não existe/);
    expect(erro({ alterados: { constructor: { texto: "x", ativo: true, baseHash: "00000000" } } })).toMatch(/não existe/);
  });

  it("alterado: campos de tipo errado", () => {
    expect(erro({ alterados: { "geral.tom": "x" } })).toMatch(/Tom e linguagem/);
    expect(erro({ alterados: { "geral.tom": { texto: 1, ativo: true, baseHash: "00000000" } } })).toMatch(/Tom e linguagem/);
    expect(erro({ alterados: { "geral.tom": { texto: "x", ativo: "sim", baseHash: "00000000" } } })).toMatch(/Tom e linguagem/);
    expect(erro({ alterados: { "geral.tom": { texto: "x", ativo: true, baseHash: "zz" } } })).toMatch(/Tom e linguagem/);
    expect(erro({ alterados: { "geral.tom": { texto: "x", ativo: true } } })).toMatch(/Tom e linguagem/);
  });

  it("alterado: bloco travado é descartado sem erro, mesmo com corpo inválido", () => {
    const d = ok({ alterados: { "geral.compliance": { texto: "", ativo: false, baseHash: "?" }, ...alt("geral.tom", "ok") } });
    expect(Object.keys(d.alterados)).toEqual(["geral.tom"]);
  });

  it("alterado desligado é aceito e guardado", () => {
    expect(ok({ alterados: alt("lead.nome", bloco("lead.nome").texto, false) }).alterados["lead.nome"].ativo).toBe(false);
  });

  it("extras: aceita e normaliza título e texto", () => {
    const x = novoExtra({ titulo: "  Meu \n título  ", texto: "  texto\r\nok\u0000  ", categoria: "diagnostico", ordem: 2.5 });
    expect(ok({ extras: [x] }).extras).toEqual([{ ...x, titulo: "Meu título", texto: "texto\nok" }]);
  });

  it("extras: ignora campos desconhecidos", () => {
    const x = { ...novoExtra(), lixo: 1 };
    expect(ok({ extras: [x] }).extras[0]).not.toHaveProperty("lixo");
  });

  it("extras: no máximo 20", () => {
    expect(ok({ extras: Array.from({ length: LIMITES.extras }, () => novoExtra({ texto: "a" })) }).extras).toHaveLength(LIMITES.extras);
    expect(erro({ extras: Array.from({ length: LIMITES.extras + 1 }, () => novoExtra({ texto: "a" })) })).toMatch(/até 20/);
  });

  it("extras: título de até 60 caracteres, não vazio", () => {
    expect(ok({ extras: [novoExtra({ titulo: "t".repeat(LIMITES.tituloBloco) })] }).extras).toHaveLength(1);
    expect(erro({ extras: [novoExtra({ titulo: "t".repeat(LIMITES.tituloBloco + 1) })] })).toMatch(/61.*60/);
    expect(erro({ extras: [novoExtra({ titulo: "   " })] })).toMatch(/título/);
  });

  it("extras: texto de até 1.500 caracteres, não vazio", () => {
    expect(ok({ extras: [novoExtra({ texto: "a".repeat(LIMITES.textoBloco) })] }).extras).toHaveLength(1);
    expect(erro({ extras: [novoExtra({ texto: "a".repeat(LIMITES.textoBloco + 1) })] })).toMatch(/1\.501.*1\.500/);
    expect(erro({ extras: [novoExtra({ texto: " \u0000 " })] })).toMatch(/vazia/);
  });

  it("extras: id no formato x_ + 12 a 32 [a-z0-9]", () => {
    for (const id of ["x_abc", "abcdefghijkl", "x_ABCDEFGHIJKL", "x_" + "a".repeat(33), "x_abcdefghijk", "x_abcdefghijk!", 5, undefined, null])
      expect(erro({ extras: [{ ...novoExtra(), id }] }), String(id)).toMatch(/identificador inválido/);
    expect(ok({ extras: [{ ...novoExtra(), id: "x_" + "a1".repeat(6) }] }).extras).toHaveLength(1);
    expect(ok({ extras: [{ ...novoExtra(), id: "x_" + "a".repeat(32) }] }).extras).toHaveLength(1);
  });

  it("extras: id repetido", () => {
    const a = novoExtra();
    expect(erro({ extras: [a, { ...novoExtra(), id: a.id }] })).toMatch(/repetido/);
  });

  it("extras: categoria válida, ativo booleano, ordem finita", () => {
    expect(erro({ extras: [{ ...novoExtra(), categoria: "outra" }] })).toMatch(/etapa inválida/);
    expect(erro({ extras: [{ ...novoExtra(), categoria: undefined }] })).toMatch(/etapa inválida/);
    expect(erro({ extras: [{ ...novoExtra(), ativo: 1 }] })).toMatch(/ligada/);
    expect(erro({ extras: [{ ...novoExtra(), ordem: "1" }] })).toMatch(/posição/);
    expect(erro({ extras: [{ ...novoExtra(), ordem: Infinity }] })).toMatch(/posição/);
    expect(erro({ extras: [{ ...novoExtra(), ordem: NaN }] })).toMatch(/posição/);
    expect(erro({ extras: [null] })).toMatch(/formato inválido/);
    expect(erro({ extras: [{ ...novoExtra(), titulo: 3 }] })).toMatch(/formato errado/);
    for (const c of CATEGORIAS) expect(ok({ extras: [novoExtra({ categoria: c })] }).extras[0].categoria).toBe(c);
  });

  it("soma dos extras ativos por etapa: até 6.000 caracteres", () => {
    const t = (n: number) => "a".repeat(n);
    // 4 × 1.500 = 6.000 em "diagnostico": cabe
    const quatro = (cat: Categoria) => Array.from({ length: 4 }, () => novoExtra({ categoria: cat, texto: t(1500) }));
    expect(ok({ extras: quatro("diagnostico") }).extras).toHaveLength(4);
    // 6.001 numa categoria
    expect(erro({ extras: [...quatro("diagnostico"), novoExtra({ categoria: "diagnostico", texto: "a" })] })).toMatch(/Diagnóstico.*6\.001.*6\.000|6\.000.*6\.001/);
  });

  it("soma: os extras de geral contam em todas as etapas, desligados não contam, categorias não se misturam", () => {
    const t = (n: number) => "a".repeat(n);
    const geral = [novoExtra({ categoria: "geral", texto: t(1500) }), novoExtra({ categoria: "geral", texto: t(1500) }), novoExtra({ categoria: "geral", texto: t(1500) })];
    // 4.500 de geral + 1.500 de lead = 6.000 (ok); + 1 = erro só pela etapa lead
    expect(ok({ extras: [...geral, novoExtra({ categoria: "lead", texto: t(1500) })] }).extras).toHaveLength(4);
    expect(erro({ extras: [...geral, novoExtra({ categoria: "lead", texto: t(1500) }), novoExtra({ categoria: "lead", texto: "a" })] })).toMatch(/Perfil do lead.*Geral/);
    // categorias diferentes não somam entre si
    expect(ok({ extras: [...geral, novoExtra({ categoria: "lead", texto: t(1500) }), novoExtra({ categoria: "notas", texto: t(1500) })] }).extras).toHaveLength(5);
    // desligado não conta
    expect(ok({ extras: [...geral, novoExtra({ categoria: "lead", texto: t(1500) }), novoExtra({ categoria: "lead", texto: t(1500), ativo: false })] }).extras).toHaveLength(5);
    // só geral passando do teto
    expect(erro({ extras: [...geral, novoExtra({ categoria: "geral", texto: t(1500) }), novoExtra({ categoria: "geral", texto: "a" })] })).toMatch(/"Geral".*6\.001/);
  });

  it("resultado é independente do corpo (sem referência ao objeto de entrada)", () => {
    const corpo = { alterados: alt("geral.tom", "ok"), extras: [novoExtra()] };
    const d = ok(corpo);
    expect(d.alterados).not.toBe(corpo.alterados);
    expect(d.extras[0]).not.toBe(corpo.extras[0]);
  });

  it("o que a validação aceita é o que a montagem usa", () => {
    const d = ok({ alterados: alt("geral.tom", "  Seja formal.  "), extras: [novoExtra({ categoria: "lead", texto: " Cite o nome. " })] });
    expect(montarSistema("lead", { ...d, versao: 2 })).toBe(
      ANTES.lead.replace(bloco("geral.tom").texto, "Seja formal.") + cabecalho + "- Cite o nome.");
  });
});
