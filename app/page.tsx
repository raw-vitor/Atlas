import { ChatShell } from "@/components/chat/ChatShell";
import { acabouDeEntrar, identidadeDaPagina } from "@/lib/pagina";

const ID_CONVERSA = /^[0-9a-f]{32}$/;

/**
 * `?c={id}` reabre a conversa ao recarregar a página.
 * A animação de entrada roda logo depois do login no Access; `?entrada` força a animação, para ver fora de produção.
 */
export default async function Page({ searchParams }: PageProps<"/">) {
  const { c, entrada } = await searchParams;
  const id = typeof c === "string" && ID_CONVERSA.test(c) ? c : undefined;
  const [{ email, sair }, recente] = await Promise.all([identidadeDaPagina(), acabouDeEntrar()]);
  return <ChatShell conversaInicial={id} email={email} sair={sair} entrada={recente || entrada !== undefined} />;
}
