import { describe, expect, it } from "vitest";
import {
  adicionarExtra, alterarBloco, apagarExtra, atualizarExtra, categoriasComErro, contarMudancas, descreverPerdas, diffPalavras, dadosVazios, duplicarExtra,
  erroDoTexto, etapasDaCategoria, extrasDa, itensDaCategoria, moverExtra, montarPrevia, mudancasPorCategoria, novoIdExtra, originalMudou, perdas, podeMover,
  reconhecerOriginal, reinserirExtra, reposicionarExtra, restaurarBloco, restaurarCategoria, selosDe, substituirCategoria, temErros, tituloAutomatico, usoExtras,
  validarDados,
} from "@/components/config/estado";
import { BLOCOS, CABECALHO_EXTRAS, CATEGORIAS_INFO, montarSistemaResumo } from "@/lib/prompt-blocos";
import { hashBase, LIMITES, type BlocoBase, type DadosConfig, type RespostaConfig } from "@/lib/prompt-tipos";

const bloco = (id: string, categoria: BlocoBase["categoria"], texto: string, p: Partial<BlocoBase> = {}): BlocoBase =>
  ({ id, categoria, titulo: id, ajuda: "", texto, hash: hashBase(texto), ...p });

const blocos: BlocoBase[] = [
  bloco("geral.papel", "geral", "Você é o Atlas. "),
  bloco("geral.compliance", "geral", "Nunca prometa rentabilidade. ", { travado: true }),
  bloco("diagnostico.riscos", "diagnostico", "Liste os riscos. "),
  bloco("diagnostico.perguntas", "diagnostico", "Faça perguntas."),
  bloco("lead.citacoes", "lead", "Cite o lead."),
];
const riscos = blocos[2];
const vazio = dadosVazios();

describe("blocos originais", () => {
  it("alterar grava texto, ativo e baseHash do bloco", () => {
    const d = alterarBloco(vazio, riscos, { texto: "Outro texto." });
    expect(d.alterados["diagnostico.riscos"]).toEqual({ texto: "Outro texto.", ativo: true, baseHash: riscos.hash });
    expect(vazio.alterados).toEqual({}); // não muta o original
  });
  it("voltar ao texto original, ligado, remove a entrada", () => {
    const d = alterarBloco(alterarBloco(vazio, riscos, { texto: "x" }), riscos, { texto: riscos.texto });
    expect(d.alterados).toEqual({});
  });
  it("desligar mantém a entrada com o texto original; religar sem edição remove", () => {
    const off = alterarBloco(vazio, riscos, { ativo: false });
    expect(off.alterados["diagnostico.riscos"]).toMatchObject({ texto: riscos.texto, ativo: false });
    expect(alterarBloco(off, riscos, { ativo: true }).alterados).toEqual({});
  });
  it("bloco travado não muda", () => {
    expect(alterarBloco(vazio, blocos[1], { texto: "x" })).toBe(vazio);
    expect(alterarBloco(vazio, blocos[1], { ativo: false })).toBe(vazio);
  });
  it("selos: original, editado, desligado, travado e combinações", () => {
    expect(selosDe(riscos, vazio)).toEqual(["original"]);
    expect(selosDe(riscos, alterarBloco(vazio, riscos, { texto: "x" }))).toEqual(["editado"]);
    expect(selosDe(riscos, alterarBloco(vazio, riscos, { ativo: false }))).toEqual(["desligado"]);
    expect(selosDe(riscos, alterarBloco(alterarBloco(vazio, riscos, { texto: "x" }), riscos, { ativo: false }))).toEqual(["editado", "desligado"]);
    expect(selosDe(blocos[1], vazio)).toEqual(["travado"]);
  });
  it("restaurar remove só aquele bloco", () => {
    const d = alterarBloco(alterarBloco(vazio, riscos, { texto: "a" }), blocos[3], { texto: "b" });
    expect(Object.keys(restaurarBloco(d, "diagnostico.riscos").alterados)).toEqual(["diagnostico.perguntas"]);
    expect(restaurarBloco(vazio, "nada")).toBe(vazio);
  });
  it("original mudou: baseHash antigo; digitar preserva o aviso, 'manter' limpa", () => {
    const antigo: DadosConfig = { alterados: { "diagnostico.riscos": { texto: "meu", ativo: true, baseHash: "00000000" } }, extras: [] };
    expect(originalMudou(riscos, antigo)).toBe(true);
    expect(originalMudou(riscos, alterarBloco(antigo, riscos, { texto: "meu 2" }, { manterBase: true }))).toBe(true);
    expect(originalMudou(riscos, alterarBloco(antigo, riscos, { texto: "meu 2" }))).toBe(false);
    expect(originalMudou(riscos, reconhecerOriginal(antigo, riscos))).toBe(false);
  });
  it("itens da categoria trazem texto efetivo, selos e o texto original", () => {
    const d = alterarBloco(vazio, riscos, { texto: "novo" });
    const itens = itensDaCategoria(blocos, d, "diagnostico");
    expect(itens.map((i) => i.id)).toEqual(["diagnostico.riscos", "diagnostico.perguntas"]);
    expect(itens[0]).toMatchObject({ texto: "novo", editado: true, textoOriginal: riscos.texto, selos: ["editado"] });
  });
});

describe("blocos próprios", () => {
  it("id é x_ + 16 caracteres [a-z0-9] e não se repete", () => {
    const ids = new Set(Array.from({ length: 200 }, () => novoIdExtra()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^x_[a-z0-9]{16}$/);
  });
  it("id ignora bytes que enviesariam o sorteio", () => {
    const seq = [255, 253, 0, 1, 35, 36, 71, 72, 251, 100, 101, 102, 103, 104, 105, 106, 107, 108];
    expect(novoIdExtra(() => new Uint8Array(32).map((_, i) => seq[i % seq.length]))).toMatch(/^x_[a-z0-9]{16}$/);
  });
  it("adicionar põe no fim, com título automático quando vazio", () => {
    const a = adicionarExtra(vazio, "geral", "Meu tom", "Seja formal.", "x_a");
    const b = adicionarExtra(a.dados, "geral", "", "Evite termos em inglês quando existir tradução comum, sempre.", "x_b");
    expect(extrasDa(b.dados, "geral").map((e) => [e.id, e.ordem, e.ativo])).toEqual([["x_a", 0, true], ["x_b", 1, true]]);
    expect(b.dados.extras[1].titulo.length).toBeLessThanOrEqual(41);
    expect(tituloAutomatico("")).toBe("Minha instrução");
  });
  it("atualizar, apagar e reinserir na mesma posição", () => {
    let d = adicionarExtra(vazio, "lead", "A", "a", "x_a").dados;
    d = adicionarExtra(d, "lead", "B", "b", "x_b").dados;
    d = adicionarExtra(d, "lead", "C", "c", "x_c").dados;
    d = atualizarExtra(d, "x_b", { texto: "bb", ativo: false });
    expect(d.extras.find((e) => e.id === "x_b")).toMatchObject({ texto: "bb", ativo: false });
    const b = d.extras.find((e) => e.id === "x_b")!;
    const sem = apagarExtra(d, "x_b");
    expect(extrasDa(sem, "lead").map((e) => e.id)).toEqual(["x_a", "x_c"]);
    expect(extrasDa(reinserirExtra(sem, b), "lead").map((e) => e.id)).toEqual(["x_a", "x_b", "x_c"]);
  });
  it("duplicar cria cópia abaixo do original e respeita o limite", () => {
    const d = adicionarExtra(adicionarExtra(vazio, "geral", "A", "a", "x_a").dados, "geral", "B", "b", "x_b").dados;
    const r = duplicarExtra(d, "x_a", "x_c")!;
    expect(extrasDa(r.dados, "geral").map((e) => e.id)).toEqual(["x_a", "x_c", "x_b"]);
    expect(r.dados.extras.find((e) => e.id === "x_c")!.titulo).toBe("A (cópia)");
    const cheio: DadosConfig = { alterados: {}, extras: Array.from({ length: LIMITES.extras }, (_, i) => ({ id: `x_${i}`, categoria: "geral", titulo: "t", texto: "t", ativo: true, ordem: i })) };
    expect(duplicarExtra(cheio, "x_0")).toBeNull();
  });
  it("mover só troca com o vizinho da mesma categoria", () => {
    let d = adicionarExtra(vazio, "geral", "A", "a", "x_a").dados;
    d = adicionarExtra(d, "lead", "L", "l", "x_l").dados;
    d = adicionarExtra(d, "geral", "B", "b", "x_b").dados;
    expect(podeMover(d, "x_a", -1)).toBe(false);
    expect(podeMover(d, "x_a", 1)).toBe(true);
    expect(moverExtra(d, "x_a", -1)).toBe(d);
    const m = moverExtra(d, "x_b", -1);
    expect(extrasDa(m, "geral").map((e) => e.id)).toEqual(["x_b", "x_a"]);
    expect(extrasDa(m, "lead").map((e) => e.id)).toEqual(["x_l"]);
    expect(m.extras.map((e) => e.ordem).sort()).toEqual([0, 1, 2]);
  });
  it("arrastar reposiciona antes ou depois do alvo, e ignora outra categoria", () => {
    let d = adicionarExtra(vazio, "geral", "A", "a", "x_a").dados;
    d = adicionarExtra(d, "geral", "B", "b", "x_b").dados;
    d = adicionarExtra(d, "geral", "C", "c", "x_c").dados;
    d = adicionarExtra(d, "lead", "L", "l", "x_l").dados;
    expect(extrasDa(reposicionarExtra(d, "x_c", "x_a", false), "geral").map((e) => e.id)).toEqual(["x_c", "x_a", "x_b"]);
    expect(extrasDa(reposicionarExtra(d, "x_a", "x_c", true), "geral").map((e) => e.id)).toEqual(["x_b", "x_c", "x_a"]);
    expect(reposicionarExtra(d, "x_a", "x_l", true)).toBe(d);
  });
});

describe("restaurar", () => {
  const montar = () => {
    let d = alterarBloco(vazio, riscos, { texto: "a" });
    d = alterarBloco(d, blocos[3], { ativo: false });
    d = alterarBloco(d, blocos[0], { texto: "geral editado" });
    d = adicionarExtra(d, "diagnostico", "X", "x", "x_d").dados;
    d = adicionarExtra(d, "geral", "G", "g", "x_g").dados;
    return d;
  };
  it("restaurar categoria tira alterados e extras só dela", () => {
    const r = restaurarCategoria(montar(), blocos, "diagnostico");
    expect(Object.keys(r.alterados)).toEqual(["geral.papel"]);
    expect(r.extras.map((e) => e.id)).toEqual(["x_g"]);
  });
  it("perdas contam editados, desligados e próprios, e descrevem em português", () => {
    const d = montar();
    expect(perdas(d, blocos, "diagnostico")).toEqual({ editados: 1, desligados: 1, proprios: 1 });
    expect(perdas(d, blocos)).toEqual({ editados: 2, desligados: 1, proprios: 2 });
    expect(descreverPerdas({ editados: 2, desligados: 0, proprios: 3 })).toBe("2 blocos editados e 3 instruções suas");
    expect(descreverPerdas({ editados: 1, desligados: 1, proprios: 1 })).toBe("1 bloco editado, 1 bloco desligado e 1 instrução sua");
    expect(descreverPerdas({ editados: 0, desligados: 0, proprios: 0 })).toBe("");
  });
  it("substituirCategoria desfaz a restauração sem tocar nas outras categorias", () => {
    const antes = montar();
    const restaurado = restaurarCategoria(antes, blocos, "diagnostico");
    const editadoDepois = alterarBloco(restaurado, blocos[4], { texto: "lead novo" });
    const desfeito = substituirCategoria(editadoDepois, blocos, "diagnostico", antes);
    expect(Object.keys(desfeito.alterados).sort()).toEqual(["diagnostico.perguntas", "diagnostico.riscos", "geral.papel", "lead.citacoes"]);
    expect(extrasDa(desfeito, "diagnostico").map((e) => e.id)).toEqual(["x_d"]);
    expect(extrasDa(desfeito, "geral").map((e) => e.id)).toEqual(["x_g"]);
  });
});

describe("contagem de mudanças", () => {
  it("sem diferença, zero", () => {
    expect(contarMudancas(vazio, vazio)).toBe(0);
    const d = alterarBloco(vazio, riscos, { texto: "a" });
    expect(contarMudancas(d, { ...d, alterados: { ...d.alterados } })).toBe(0);
  });
  it("cada bloco original diferente conta 1, e mudar duas vezes o mesmo conta 1", () => {
    const d = alterarBloco(alterarBloco(vazio, riscos, { texto: "a" }), riscos, { texto: "b" });
    expect(contarMudancas(vazio, d)).toBe(1);
    expect(contarMudancas(vazio, alterarBloco(d, blocos[3], { ativo: false }))).toBe(2);
  });
  it("extras novos, editados e apagados contam 1 cada", () => {
    const salvo = adicionarExtra(adicionarExtra(vazio, "geral", "A", "a", "x_a").dados, "geral", "B", "b", "x_b").dados;
    expect(contarMudancas(salvo, adicionarExtra(salvo, "lead", "C", "c", "x_c").dados)).toBe(1);
    expect(contarMudancas(salvo, atualizarExtra(salvo, "x_a", { texto: "aa" }))).toBe(1);
    expect(contarMudancas(salvo, apagarExtra(salvo, "x_a"))).toBe(1);
  });
  it("reordenar conta 1 por categoria, não 1 por bloco", () => {
    const salvo = ["x_a", "x_b", "x_c"].reduce((d, id) => adicionarExtra(d, "geral", id, id, id).dados, vazio);
    expect(contarMudancas(salvo, moverExtra(salvo, "x_c", -1))).toBe(1);
    expect(contarMudancas(salvo, moverExtra(moverExtra(salvo, "x_c", -1), "x_c", 1))).toBe(0);
  });
  it("por categoria separa blocos originais e próprios", () => {
    let d = alterarBloco(vazio, riscos, { texto: "a" });
    d = alterarBloco(d, blocos[4], { ativo: false });
    d = adicionarExtra(d, "diagnostico", "X", "x", "x_d").dados;
    const m = mudancasPorCategoria(vazio, d, blocos);
    expect(m).toMatchObject({ diagnostico: 2, lead: 1, geral: 0, notas: 0 });
  });
});

describe("validação local", () => {
  it("texto de bloco original vazio ou só com espaços é erro; extra vazio também", () => {
    expect(erroDoTexto("   ", true)).toMatch(/desligue/);
    expect(erroDoTexto("", false)).toMatch(/apague/);
    expect(erroDoTexto("ok", true)).toBeNull();
    const d = alterarBloco(vazio, riscos, { texto: "  " });
    const e = validarDados(d, blocos);
    expect(e.blocos["diagnostico.riscos"]).toBeTruthy();
    expect(temErros(e)).toBe(true);
    expect(categoriasComErro(e, d, blocos)).toEqual(new Set(["diagnostico"]));
  });
  it("passar de 1500 caracteres é erro", () => {
    expect(erroDoTexto("a".repeat(LIMITES.textoBloco), false)).toBeNull();
    expect(erroDoTexto("a".repeat(LIMITES.textoBloco + 1), false)).toMatch(/limite/);
  });
  it("texto vazio num original editado é erro mesmo com o bloco desligado (o servidor exige texto)", () => {
    expect(validarDados(alterarBloco(vazio, riscos, { texto: "" }), blocos).blocos["diagnostico.riscos"]).toBeTruthy();
  });
  it("soma dos extras ativos da etapa (com os gerais) acima de 6000 é erro; desligados não contam", () => {
    const grande = (n: number) => "a".repeat(n);
    let d = adicionarExtra(vazio, "geral", "G1", grande(1500), "x_g1").dados;
    d = adicionarExtra(d, "geral", "G2", grande(1500), "x_g2").dados;
    d = adicionarExtra(d, "diagnostico", "D1", grande(1500), "x_d1").dados;
    d = adicionarExtra(d, "diagnostico", "D2", grande(1500), "x_d2").dados;
    expect(temErros(validarDados(d, blocos))).toBe(false); // 6000 exatos cabem
    d = adicionarExtra(d, "diagnostico", "D3", grande(500), "x_d3").dados;
    expect(usoExtras(d, "diagnostico")).toBe(6500);
    expect(usoExtras(d, "lead")).toBe(3000);
    const e = validarDados(d, blocos);
    expect(Object.keys(e.categorias)).toEqual(["diagnostico"]);
    expect(temErros(validarDados(atualizarExtra(d, "x_d3", { ativo: false }), blocos))).toBe(false);
  });
  it("mais de 20 extras é erro geral; título acima de 60 é erro do bloco", () => {
    const d: DadosConfig = { alterados: {}, extras: Array.from({ length: 21 }, (_, i) => ({ id: `x_${i}`, categoria: "geral", titulo: "t", texto: "t", ativo: true, ordem: i })) };
    expect(validarDados(d, blocos).geral).toMatch(/20/);
    const t = atualizarExtra(adicionarExtra(vazio, "geral", "", "a", "x_a").dados, "x_a", { titulo: "t".repeat(61) });
    expect(validarDados(t, blocos).blocos["x_a"]).toMatch(/título/);
  });
  it("estado sem mudanças não tem erros", () => {
    expect(temErros(validarDados(vazio, blocos))).toBe(false);
  });
});

describe("diferença por palavras", () => {
  it("marca o que saiu e o que entrou", () => {
    const t = diffPalavras("Liste os riscos principais.", "Liste os riscos reais principais.");
    expect(t.filter((x) => x.tipo === "adicionado").map((x) => x.texto.trim())).toEqual(["reais"]);
    expect(t.filter((x) => x.tipo === "removido")).toEqual([]);
    expect(t.map((x) => x.texto).join("")).toContain("Liste os riscos");
  });
  it("textos iguais não têm diferença", () => {
    expect(diffPalavras("a b", "a b")).toEqual([{ texto: "a b", tipo: "igual" }]);
  });
  it("texto trocado por inteiro", () => {
    const t = diffPalavras("um", "dois");
    expect(t.map((x) => x.tipo).sort()).toEqual(["adicionado", "removido"]);
  });
});

describe("prévia do prompt final", () => {
  const real: Pick<RespostaConfig, "categorias" | "tamanhoKb"> = {
    categorias: CATEGORIAS_INFO,
    tamanhoKb: { ativos: 0, ativos_transcricao: 0, lead: 1000, alocacao: 2000, diagnostico: 52341, decisao: 3000, notas: 4000 },
  };
  const junta = (p: ReturnType<typeof montarPrevia>) => p.segmentos.map((s) => s.texto).join("");
  const bloco0 = (id: string) => BLOCOS.find((b) => b.id === id)!;

  it("sem mudanças, o texto é o do montador oficial; a base vira uma referência recolhível", () => {
    const p = montarPrevia("diagnostico", real, vazio);
    expect(junta(p)).toBe(montarSistemaResumo("diagnostico", vazio, 52341).map((t) => t.texto).join(""));
    const ref = p.segmentos.filter((s) => s.tipo === "referencia");
    expect(ref).toHaveLength(1);
    expect(ref[0].texto).toMatch(/52\.341 caracteres/);
    expect(ref[0].itens).toEqual(CATEGORIAS_INFO.find((c) => c.id === "diagnostico")!.referencia);
    expect(p.segmentos.some((s) => s.tipo === "assessor")).toBe(false);
    expect(p.avisoEtapas).toBeNull();
  });
  it("bloco editado vira trecho do assessor; desligado some; travado fica", () => {
    let d = alterarBloco(vazio, bloco0("diagnostico.riscos"), { texto: "Riscos do jeito do assessor." });
    d = alterarBloco(d, bloco0("diagnostico.perguntas"), { ativo: false });
    const p = montarPrevia("diagnostico", real, d);
    expect(p.segmentos.filter((s) => s.tipo === "assessor").map((s) => s.texto)).toEqual(["Riscos do jeito do assessor."]);
    expect(junta(p)).not.toContain(bloco0("diagnostico.perguntas").texto.trim());
    expect(junta(p)).toContain(bloco0("geral.compliance").texto.trim());
  });
  it("extras ativos de geral e da etapa entram no fim, sob o cabeçalho; os de outras etapas e desligados não", () => {
    let d = adicionarExtra(vazio, "diagnostico", "D", "  Seja direto.  ", "x_d").dados;
    d = adicionarExtra(d, "geral", "G", "Tom formal.", "x_g").dados;
    d = adicionarExtra(d, "lead", "L", "Só do lead.", "x_l").dados;
    d = atualizarExtra(adicionarExtra(d, "geral", "O", "Desligada.", "x_o").dados, "x_o", { ativo: false });
    const p = montarPrevia("diagnostico", real, d);
    expect(p.segmentos.find((s) => s.tipo === "extras")).toEqual({ tipo: "extras", texto: CABECALHO_EXTRAS });
    expect(p.segmentos.filter((s) => s.tipo === "assessor").map((s) => s.texto)).toEqual(["Seja direto.", "Tom formal."]);
    expect(junta(p)).not.toContain("Só do lead");
    expect(junta(p)).not.toContain("Desligada");
  });
  it("categoria com duas etapas avisa; etapas sem base não têm referência", () => {
    expect(etapasDaCategoria("carteira")).toEqual(["ativos", "ativos_transcricao"]);
    const p = montarPrevia("ativos_transcricao", real, vazio);
    expect(p.avisoEtapas).toMatch(/2 etapas/);
    expect(p.segmentos.some((s) => s.tipo === "referencia")).toBe(false);
  });
  it("sem tamanhoKb na resposta, a referência aparece sem o número", () => {
    const p = montarPrevia("lead", { categorias: CATEGORIAS_INFO, tamanhoKb: undefined as never }, vazio);
    expect(p.segmentos.find((s) => s.tipo === "referencia")!.texto).not.toMatch(/caracteres/);
  });
});
