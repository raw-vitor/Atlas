"use client";
import { Box, Button, Dialog, Flex, Grid, Heading, Portal, Progress, Skeleton, Stack, Text, VisuallyHidden } from "@chakra-ui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuArrowLeft, LuCircleAlert, LuEye, LuRotateCcw } from "react-icons/lu";
import { hrefChat } from "@/components/chat/configPrompt";
import { formatarTokens, nivelDe, pctDe } from "@/components/chat/contexto";
import { UsuarioSessao } from "@/components/UsuarioSessao";
import { LIMITES, type BlocoExtra, type Categoria, type DadosConfig, type RespostaConfig } from "@/lib/prompt-tipos";
import { ErroConfig, obterConfig, restaurarTudo, salvarConfig } from "./api";
import { avisar, avisarComDesfazer, Avisos } from "./avisos";
import { BlocoCard, type ArrastoCard } from "./BlocoCard";
import { CategoriaNav } from "./CategoriaNav";
import {
  adicionarExtra, alterarBloco, apagarExtra, atualizarExtra, categoriasComErro, contarMudancas, copiarDados, dadosVazios, descreverPerdas, duplicarExtra,
  igualDados, itensDaCategoria, moverExtra, mudancasPorCategoria, perdas, podeMover, reconhecerOriginal, reinserirExtra, reposicionarExtra, restaurarBloco,
  restaurarCategoria, substituirCategoria, temErros, temPerdas, usoExtras, validarDados, type ItemBloco,
} from "./estado";
import { NovoBloco } from "./NovoBloco";
import { PromptFinal } from "./PromptFinal";

type Carga = "carregando" | "ok" | "erro";
type TipoDialogo = "etapa" | "tudo" | "sair";

const paraDados = (c: { alterados: DadosConfig["alterados"]; extras: DadosConfig["extras"] }): DadosConfig => copiarDados({ alterados: c.alterados, extras: c.extras });
const LARGURA = "1040px";

export function PromptEditor({ voltarId, email, sair = false }: { voltarId?: string; email?: string | null; sair?: boolean }) {
  const destinoChat = hrefChat(voltarId);
  const router = useRouter();
  const [carga, setCarga] = useState<Carga>("carregando");
  const [erroCarga, setErroCarga] = useState("");
  const [resp, setResp] = useState<RespostaConfig | null>(null);
  const [rascunho, setRascunho] = useState<DadosConfig>(dadosVazios());
  const [categoria, setCategoria] = useState<Categoria>("geral");
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [conflito, setConflito] = useState<{ atual: RespostaConfig | null } | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const [gaveta, setGaveta] = useState(false);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [dialogoTipo, setDialogoTipo] = useState<TipoDialogo>("etapa");
  const [anuncio, setAnuncio] = useState("");
  const focoRef = useRef<string | null>(null);
  const [arrasto, setArrasto] = useState<{ id: string; sobre: string | null; depois: boolean } | null>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);

  const salvo: DadosConfig = useMemo(() => (resp ? paraDados(resp.config) : dadosVazios()), [resp]);
  const blocos = useMemo(() => resp?.blocos ?? [], [resp]);

  const receber = useCallback((r: RespostaConfig) => {
    setResp(r); setRascunho(paraDados(r.config)); setConflito(null); setErroSalvar(null);
    setCategoria((atual) => (r.categorias.some((c) => c.id === atual) ? atual : (r.categorias[0]?.id ?? "geral")));
    setCarga("ok");
  }, []);
  const falhou = useCallback((e: unknown) => {
    setErroCarga(e instanceof ErroConfig ? e.message : "Algo deu errado. Tente de novo.");
    setCarga("erro");
  }, []);
  useEffect(() => {
    let vivo = true;
    obterConfig().then((r) => { if (vivo) receber(r); }, (e) => { if (vivo) falhou(e); });
    return () => { vivo = false; };
  }, [receber, falhou]);
  const carregar = useCallback(() => {
    setCarga("carregando"); setErroCarga("");
    obterConfig().then(receber, falhou);
  }, [receber, falhou]);

  // ───── derivados ─────
  const totalMudancas = useMemo(() => contarMudancas(salvo, rascunho), [salvo, rascunho]);
  const porCategoria = useMemo(() => mudancasPorCategoria(salvo, rascunho, blocos), [salvo, rascunho, blocos]);
  const erros = useMemo(() => validarDados(rascunho, blocos), [rascunho, blocos]);
  const comErro = useMemo(() => categoriasComErro(erros, rascunho, blocos), [erros, rascunho, blocos]);
  const temMudancas = totalMudancas > 0;
  const info = resp?.categorias.find((c) => c.id === categoria);
  const itens = useMemo(() => itensDaCategoria(blocos, rascunho, categoria), [blocos, rascunho, categoria]);

  // ───── sair com mudanças ─────
  useEffect(() => {
    if (!temMudancas) return;
    const aoSair = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [temMudancas]);

  // O aviso de conflito fica no topo da coluna; se o assessor estava lá embaixo, ele precisa vê-lo.
  useEffect(() => { if (conflito) window.scrollTo({ top: 0, behavior: "smooth" }); }, [conflito]);

  const abrirDialogo = (t: TipoDialogo) => { setDialogoTipo(t); setDialogoAberto(true); };

  // ───── salvar ─────
  const salvar = useCallback(async () => {
    if (!resp || salvando || conflito || !temMudancas || temErros(erros)) return;
    const enviado = rascunho;
    setSalvando(true); setErroSalvar(null);
    try {
      const nova = await salvarConfig({ versao: resp.config.versao, alterados: enviado.alterados, extras: enviado.extras });
      setResp(nova);
      // Se o assessor não digitou nada durante o envio, o rascunho passa a ser o que o servidor guardou (já aparado).
      setRascunho((atual) => (atual === enviado ? paraDados(nova.config) : atual));
      avisar("Instruções salvas", "Valem para as próximas gerações. Conversas já geradas não mudam.");
    } catch (e) {
      if (e instanceof ErroConfig && e.status === 409) setConflito({ atual: e.atual });
      else setErroSalvar(e instanceof ErroConfig ? e.message : "Não consegui salvar. Tente de novo.");
    } finally { setSalvando(false); }
  }, [resp, salvando, conflito, temMudancas, erros, rascunho]);

  const salvarRef = useRef(salvar);
  useEffect(() => { salvarRef.current = salvar; }, [salvar]);
  useEffect(() => {
    const aoTecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void salvarRef.current(); }
    };
    window.addEventListener("keydown", aoTecla);
    return () => window.removeEventListener("keydown", aoTecla);
  }, []);

  const recarregarConflito = () => {
    const a = conflito?.atual;
    if (a) { setResp(a); setRascunho(paraDados(a.config)); setConflito(null); setErroSalvar(null); }
    else carregar();
  };

  const descartar = () => {
    const antes = rascunho;
    setRascunho(salvo); setErroSalvar(null);
    avisarComDesfazer(`${totalMudancas === 1 ? "Alteração descartada" : "Alterações descartadas"}`, () => setRascunho(antes));
  };

  // ───── edição de blocos ─────
  const aplicar = (fn: (d: DadosConfig) => DadosConfig) => setRascunho(fn);
  const bloco = (id: string) => blocos.find((b) => b.id === id);

  const restaurarUm = (item: ItemBloco) => {
    const entrada = rascunho.alterados[item.id];
    if (!entrada) return;
    aplicar((d) => restaurarBloco(d, item.id));
    avisarComDesfazer("Bloco restaurado", () => aplicar((d) => ({ ...d, alterados: { ...d.alterados, [item.id]: entrada } })));
  };

  const apagarUm = (item: ItemBloco) => {
    const extra: BlocoExtra | undefined = rascunho.extras.find((e) => e.id === item.id);
    if (!extra) return;
    aplicar((d) => apagarExtra(d, item.id));
    setAnuncio(`Instrução ${item.titulo} apagada.`);
    avisarComDesfazer("Instrução apagada", () => aplicar((d) => reinserirExtra(d, extra)));
  };

  const duplicarUm = (item: ItemBloco) => {
    const r = duplicarExtra(rascunho, item.id);
    if (!r) return;
    setRascunho(r.dados); focoRef.current = r.id;
    setAnuncio("Instrução duplicada.");
  };

  const moverUm = (item: ItemBloco, delta: -1 | 1) => {
    const antes = itens.filter((i) => i.tipo === "extra");
    const nova = moverExtra(rascunho, item.id, delta);
    if (nova === rascunho) return;
    setRascunho(nova);
    const pos = antes.findIndex((i) => i.id === item.id) + delta + 1;
    setAnuncio(`${item.titulo} movida para a posição ${pos} de ${antes.length}.`);
  };

  const adicionar = (titulo: string, texto: string) => {
    const r = adicionarExtra(rascunho, categoria, titulo, texto);
    setRascunho(r.dados); focoRef.current = r.id;
    setAnuncio("Instrução adicionada.");
  };

  // O foco vai para o card recém-criado e a página rola só se ele estiver fora da tela.
  useEffect(() => {
    const id = focoRef.current;
    if (!id) return;
    const el = document.getElementById(`bloco-${id}`);
    if (el) { focoRef.current = null; el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }, [rascunho]);

  // ───── restaurar etapa / tudo ─────
  const perdasEtapa = perdas(rascunho, blocos, categoria);
  const perdasSalvas = perdas(salvo, blocos);
  const perdasTudo = perdas(rascunho, blocos);

  const confirmarEtapa = () => {
    const antes = copiarDados(rascunho), cat = categoria;
    aplicar((d) => restaurarCategoria(d, blocos, cat));
    setDialogoAberto(false);
    avisarComDesfazer("Etapa restaurada. Falta salvar.", () => aplicar((d) => substituirCategoria(d, blocos, cat, antes)));
  };

  const confirmarTudo = async () => {
    if (!resp) return;
    const salvoAntes = salvo, rascunhoAntes = rascunho;
    setDialogoAberto(false); setRestaurando(true);
    try {
      const nova = await restaurarTudo();
      setResp(nova); setRascunho(paraDados(nova.config)); setConflito(null); setErroSalvar(null);
      avisarComDesfazer("Tudo voltou ao original", async () => {
        try {
          if (!igualDados(salvoAntes, dadosVazios())) {
            const volta = await salvarConfig({ versao: nova.config.versao, alterados: salvoAntes.alterados, extras: salvoAntes.extras });
            setResp(volta);
            setRascunho(rascunhoAntes);
          } else setRascunho(rascunhoAntes);
          avisar("Suas instruções voltaram.");
        } catch (e) {
          avisar("Não consegui desfazer", e instanceof ErroConfig ? e.message : undefined);
        }
      });
    } catch (e) {
      avisar("Não consegui restaurar", e instanceof ErroConfig ? e.message : "Tente de novo.");
    } finally { setRestaurando(false); }
  };

  const aoVoltar = (e: React.MouseEvent) => {
    if (!temMudancas) return;
    e.preventDefault();
    abrirDialogo("sair");
  };

  // ───── arrastar ─────
  const arrastoDe = (item: ItemBloco): ArrastoCard | undefined => item.tipo !== "extra" ? undefined : {
    arrastando: arrasto !== null,
    origem: arrasto?.id === item.id,
    indicador: arrasto && arrasto.sobre === item.id && arrasto.id !== item.id ? (arrasto.depois ? "depois" : "antes") : null,
    onInicio: () => setArrasto({ id: item.id, sobre: null, depois: false }),
    onSobre: (depois) => setArrasto((a) => (a && (a.sobre !== item.id || a.depois !== depois) ? { ...a, sobre: item.id, depois } : a)),
    onSoltar: () => {
      if (arrasto?.sobre) {
        const nova = reposicionarExtra(rascunho, arrasto.id, arrasto.sobre, arrasto.depois);
        if (nova !== rascunho) { setRascunho(nova); setAnuncio("Ordem das instruções alterada."); }
      }
      setArrasto(null);
    },
    onFim: () => setArrasto(null),
  };

  // ───── medidor da etapa ─────
  const uso = usoExtras(rascunho, categoria);
  const usoPct = pctDe(uso, LIMITES.extrasPorEtapa);
  const estourou = uso > LIMITES.extrasPorEtapa;
  const textoMedidor = categoria === "geral"
    ? `Suas instruções gerais: ${formatarTokens(uso)} de ${formatarTokens(LIMITES.extrasPorEtapa)} caracteres. Elas somam ao limite de cada etapa.`
    : `Suas instruções nesta etapa, com as gerais: ${formatarTokens(uso)} de ${formatarTokens(LIMITES.extrasPorEtapa)} caracteres.`;

  const barraVisivel = carga === "ok" && temMudancas;
  const bloqueado = temErros(erros);

  return (
    <Box minH="100dvh" bg="neve" color="floresta" pb="28">
      <Avisos />
      <VisuallyHidden aria-live="polite" aria-atomic="true">{anuncio}</VisuallyHidden>

      {/* Cabeçalho */}
      <Box as="header" borderBottomWidth="1px" borderColor="nevoa" bg="neve">
        <Box maxW={LARGURA} mx="auto" px="4" py="3">
          <Flex align="center" justify="space-between" gap="3" wrap="wrap">
            <Link href={destinoChat} onClick={aoVoltar} aria-label="Voltar ao chat">
              <Flex as="span" align="center" gap="1.5" fontSize="sm" color="profundo" rounded="md" px="1" py="1" _hover={{ color: "floresta", textDecoration: "underline" }}>
                <LuArrowLeft aria-hidden /> Voltar ao chat
              </Flex>
            </Link>
            <Flex align="center" gap="3" minW="0">
              {email && <UsuarioSessao email={email} sair={sair} />}
              <Button size="sm" variant="outline" borderColor="profundo" color="profundo" disabled={carga !== "ok"} onClick={() => setGaveta(true)}><LuEye /> Ver texto final</Button>
            </Flex>
          </Flex>
          <Heading as="h1" size={{ base: "lg", md: "xl" }} color="profundo" mt="3" fontWeight="semibold">Como o Atlas monta a sua R2</Heading>
          <Text fontSize="sm" color="profundo" mt="1">As mudanças valem só para você, nas próximas gerações.</Text>
        </Box>
      </Box>

      <Box as="main" maxW={LARGURA} mx="auto" px="4" pt={{ base: "0", md: "6" }}>
        {carga === "carregando" && <Esqueleto />}

        {carga === "erro" && (
          <Flex direction="column" align="flex-start" gap="3" mt="8" role="alert" maxW="md">
            <Text fontWeight="semibold" color="profundo">Não consegui carregar as suas instruções.</Text>
            <Text fontSize="sm">{erroCarga}</Text>
            <Button size="sm" bg="profundo" color="neve" _hover={{ bg: "floresta" }} onClick={carregar}>Tentar de novo</Button>
          </Flex>
        )}

        {carga === "ok" && resp && (
          <Grid templateColumns={{ base: "minmax(0,1fr)", md: "210px minmax(0,1fr)" }} columnGap="8">
            <Box position="sticky" top={{ base: "0", md: "4" }} alignSelf="start" zIndex={2} bg="neve" pt={{ base: "3", md: "0" }} mx={{ base: "-4", md: "0" }} px={{ base: "4", md: "0" }}
              borderBottomWidth={{ base: "1px", md: "0" }} borderColor="nevoa" mb={{ base: "4", md: "0" }}>
              <CategoriaNav categorias={resp.categorias} ativa={categoria} mudancas={porCategoria} comErro={comErro} onSelecionar={setCategoria} />
            </Box>

            <Box minW="0">
              {conflito && (
                <Flex role="alert" mb="4" p="3" gap="3" align={{ base: "stretch", sm: "center" }} direction={{ base: "column", sm: "row" }} bg="areia" borderWidth="1px" borderColor="profundo" rounded="lg">
                  <Box flex="1">
                    <Text fontSize="xs" fontWeight="bold" letterSpacing="wider" color="profundo">ATENÇÃO</Text>
                    <Text fontSize="sm">Esta configuração mudou em outra aba. Suas edições continuam aqui para você copiar o que quiser. Recarregar traz a versão salva e descarta o que está na tela.</Text>
                  </Box>
                  <Button size="sm" bg="profundo" color="neve" _hover={{ bg: "floresta" }} onClick={recarregarConflito}>Recarregar</Button>
                </Flex>
              )}

              <Flex align="flex-start" justify="space-between" gap="3" wrap="wrap">
                <Box minW="0" flex="1">
                  <Heading as="h2" size="lg" color="profundo" fontWeight="semibold">{info?.titulo ?? ""}</Heading>
                  {info?.descricao && <Text fontSize="sm" mt="1">{info.descricao}</Text>}
                  <Box mt="1.5" fontSize="xs" color="profundo">
                    {info && info.slides.length > 0 && <Text><b>Muda:</b> {info.slides.join(", ")}.</Text>}
                    {info && info.referencia.length > 0 && <Text><b>Referência (não editável):</b> {info.referencia.join(", ")}.</Text>}
                  </Box>
                </Box>
                <Button size="sm" variant="outline" borderColor="profundo" color="profundo" disabled={!temPerdas(perdasEtapa)} onClick={() => abrirDialogo("etapa")}>
                  <LuRotateCcw /> Restaurar etapa
                </Button>
              </Flex>

              <Box mt="4" mb="4">
                <Progress.Root value={Math.min(uso, LIMITES.extrasPorEtapa)} max={LIMITES.extrasPorEtapa} size="xs" aria-label="Uso do limite das suas instruções nesta etapa">
                  <Progress.Track bg="contexto.trilha" rounded="full"><Progress.Range bg={`contexto.${nivelDe(usoPct)}`} /></Progress.Track>
                </Progress.Root>
                <Text mt="1" fontSize="xs" color="profundo" fontWeight={estourou ? "bold" : "normal"} display="flex" gap="1.5" alignItems="flex-start">
                  {estourou && <Box as="span" mt="0.5" flexShrink={0}><LuCircleAlert aria-hidden /></Box>}
                  <span>{estourou ? (erros.categorias[categoria] ?? textoMedidor) : textoMedidor}</span>
                </Text>
              </Box>

              <Stack gap="3" as="div" role="list" aria-label={`Blocos de ${info?.titulo ?? "categoria"}`}>
                {itens.map((item) => {
                  const original = item.tipo === "original" ? bloco(item.id) : undefined;
                  return (
                    <Box key={item.id} role="listitem">
                      <BlocoCard item={item} erro={erros.blocos[item.id] ?? null}
                        podeSubir={podeMover(rascunho, item.id, -1)} podeDescer={podeMover(rascunho, item.id, 1)} podeDuplicar={rascunho.extras.length < LIMITES.extras}
                        arrasto={arrastoDe(item)}
                        onTexto={(texto) => aplicar((d) => original ? alterarBloco(d, original, { texto }, { manterBase: true }) : atualizarExtra(d, item.id, { texto }))}
                        onTitulo={(titulo) => aplicar((d) => atualizarExtra(d, item.id, { titulo }))}
                        onAtivo={(ativo) => aplicar((d) => original ? alterarBloco(d, original, { ativo }, { manterBase: true }) : atualizarExtra(d, item.id, { ativo }))}
                        onRestaurar={() => restaurarUm(item)}
                        onDuplicar={() => duplicarUm(item)}
                        onApagar={() => apagarUm(item)}
                        onMover={(delta) => moverUm(item, delta)}
                        onManterVersao={() => original && aplicar((d) => reconhecerOriginal(d, original))} />
                    </Box>
                  );
                })}
                {itens.length === 0 && <Text fontSize="sm" color="profundo">Esta etapa não tem blocos originais. Você pode adicionar instruções suas abaixo.</Text>}
              </Stack>

              <Box mt="3">
                <NovoBloco key={categoria} categoria={categoria} tituloCategoria={info?.titulo ?? ""} limiteAtingido={rascunho.extras.length >= LIMITES.extras}
                  restante={Math.max(0, LIMITES.extrasPorEtapa - uso)} aoAdicionar={adicionar} />
              </Box>

              {/* Zona separada: restaurar tudo */}
              <Box mt="12" pt="6" borderTopWidth="1px" borderColor="nevoa">
                <Heading as="h2" size="sm" color="profundo" fontWeight="semibold">Restaurar tudo ao original</Heading>
                <Text fontSize="sm" mt="1" maxW="lg">Apaga todas as suas edições e instruções, em todas as etapas, e o Atlas volta a usar as instruções originais. Dá para desfazer logo depois.</Text>
                <Button mt="3" size="sm" variant="outline" borderColor="profundo" color="profundo" loading={restaurando}
                  disabled={!temPerdas(perdasSalvas) && !temPerdas(perdasTudo)} onClick={() => abrirDialogo("tudo")}>
                  <LuRotateCcw /> Restaurar tudo ao original
                </Button>
              </Box>
            </Box>
          </Grid>
        )}
      </Box>

      {/* Barra de salvar: fixa, só visível com mudança. Fica sempre montada para o anúncio de leitor de tela e para não deslocar nada. */}
      <Box position="fixed" left="0" right="0" bottom="0" zIndex={5} bg="neve" borderTopWidth="1px" borderColor="nevoa" boxShadow="0 -2px 8px rgba(0, 41, 30, 0.06)"
        pb="env(safe-area-inset-bottom)" opacity={barraVisivel ? 1 : 0} visibility={barraVisivel ? "visible" : "hidden"} transform={barraVisivel ? "none" : "translateY(8px)"}
        transition="opacity 0.2s ease, transform 0.2s ease, visibility 0s linear" css={{ transitionDelay: barraVisivel ? "0s" : "0s, 0s, 0.2s" }}>
        <Flex maxW={LARGURA} mx="auto" px="4" py="3" gap="3" align="center" justify="space-between" wrap="wrap">
          <Box role="status" aria-live="polite" minW="0" flex="1">
            <Text fontSize="sm" color="floresta" fontWeight="medium">
              {totalMudancas} {totalMudancas === 1 ? "alteração não salva" : "alterações não salvas"}
            </Text>
            {(erroSalvar || bloqueado || conflito) && (
              <Text fontSize="xs" color="profundo" fontWeight="medium">
                {erroSalvar ?? (conflito ? "Recarregue para poder salvar." : "Corrija os pontos marcados para poder salvar.")}
              </Text>
            )}
          </Box>
          <Flex gap="2">
            <Button size="sm" variant="ghost" color="profundo" onClick={descartar} disabled={salvando} tabIndex={barraVisivel ? 0 : -1}>Descartar</Button>
            <Button size="sm" bg="profundo" color="neve" _hover={{ bg: "floresta" }} _disabled={{ bg: "nevoa", color: "profundo", opacity: 0.8 }} onClick={() => void salvar()}
              loading={salvando} disabled={bloqueado || !!conflito} tabIndex={barraVisivel ? 0 : -1} title="Ctrl+S">Salvar</Button>
          </Flex>
        </Flex>
      </Box>

      {resp && <PromptFinal aberta={gaveta} onFechar={() => setGaveta(false)} resp={resp} dados={rascunho} categoriaAtual={categoria} naoSalvo={temMudancas} />}

      <Dialog.Root role="alertdialog" open={dialogoAberto} onOpenChange={(e) => setDialogoAberto(e.open)} initialFocusEl={() => cancelarRef.current} placement="center" lazyMount unmountOnExit>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="neve" color="floresta" mx="4">
              <Dialog.Header>
                <Dialog.Title color="profundo">
                  {dialogoTipo === "etapa" ? `Restaurar ${info?.titulo ?? "a etapa"}?` : dialogoTipo === "tudo" ? "Restaurar tudo ao original?" : "Sair sem salvar?"}
                </Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                {dialogoTipo === "etapa" && <Perdas texto={descreverPerdas(perdasEtapa)} depois="Isso muda o rascunho; falta salvar. Você pode desfazer em seguida." />}
                {dialogoTipo === "tudo" && (
                  <Perdas texto={descreverPerdas(perdasSalvas)} depois={`Vale para todas as etapas e é salvo na hora.${temMudancas ? " As alterações não salvas também se perdem." : ""} Você pode desfazer em seguida.`} />
                )}
                {dialogoTipo === "sair" && <Text>Você tem {totalMudancas} {totalMudancas === 1 ? "alteração não salva" : "alterações não salvas"}. Se sair agora, elas se perdem.</Text>}
              </Dialog.Body>
              <Dialog.Footer gap="2">
                <Button ref={cancelarRef} variant="outline" borderColor="profundo" color="profundo" onClick={() => setDialogoAberto(false)}>
                  {dialogoTipo === "sair" ? "Continuar editando" : "Cancelar"}
                </Button>
                <Button bg="profundo" color="neve" _hover={{ bg: "floresta" }}
                  onClick={() => { if (dialogoTipo === "etapa") confirmarEtapa(); else if (dialogoTipo === "tudo") void confirmarTudo(); else { setDialogoAberto(false); router.push(destinoChat); } }}>
                  {dialogoTipo === "etapa" ? "Restaurar etapa" : dialogoTipo === "tudo" ? "Restaurar tudo" : "Sair sem salvar"}
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Box>
  );
}

/** Frase do diálogo de restaurar: lista o que será perdido. */
function Perdas({ texto, depois }: { texto: string; depois: string }) {
  return (
    <>
      <Text>{texto ? <>Você vai perder: <b>{texto}</b>.</> : "Não há edições salvas para perder."}</Text>
      <Text mt="2" fontSize="sm" color="profundo">{depois}</Text>
    </>
  );
}

const COR_ESQUELETO = { "--start-color": "colors.areia", "--end-color": "colors.nevoa" };

/** Carregando: o mesmo formato da tela pronta (navegação, cabeçalho da etapa e cards), para nada pular quando os dados chegam. */
function Esqueleto() {
  return (
    <Grid templateColumns={{ base: "minmax(0,1fr)", md: "210px minmax(0,1fr)" }} columnGap="8" pt={{ base: "4", md: "0" }} role="status" aria-busy="true">
      <VisuallyHidden>Carregando as suas instruções</VisuallyHidden>
      <Flex direction={{ base: "row", md: "column" }} gap="2" mb={{ base: "4", md: "0" }} overflow="hidden">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton css={COR_ESQUELETO} key={i} h="9" w={{ base: "28", md: "full" }} flexShrink={0} rounded="md" />)}
      </Flex>
      <Box>
        <Skeleton css={COR_ESQUELETO} h="8" w="56" rounded="md" />
        <Skeleton css={COR_ESQUELETO} h="4" w="full" maxW="lg" mt="3" rounded="md" />
        <Skeleton css={COR_ESQUELETO} h="2" w="full" mt="6" rounded="full" />
        <Stack gap="3" mt="6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Box key={i} bg="areia" borderWidth="1px" borderColor="nevoa" rounded="lg" p="3">
              <Flex justify="space-between" align="center"><Skeleton css={COR_ESQUELETO} h="5" w="44" rounded="md" /><Skeleton css={COR_ESQUELETO} h="5" w="16" rounded="full" /></Flex>
              <Skeleton css={COR_ESQUELETO} h="3.5" w="full" mt="3" rounded="md" />
              <Skeleton css={COR_ESQUELETO} h="3.5" w="4/5" mt="2" rounded="md" />
            </Box>
          ))}
        </Stack>
      </Box>
    </Grid>
  );
}
