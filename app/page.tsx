import { ChatShell } from "@/components/chat/ChatShell";
import { identidadeDaPagina } from "@/lib/pagina";

const ID_CONVERSA = /^[0-9a-f]{32}$/;

/** `?c={id}` reabre a conversa ao recarregar a página. */
export default async function Page({ searchParams }: PageProps<"/">) {
  const { c } = await searchParams;
  const id = typeof c === "string" && ID_CONVERSA.test(c) ? c : undefined;
  const { email, sair } = await identidadeDaPagina();
  return <ChatShell conversaInicial={id} email={email} sair={sair} />;
}
