import { ChatShell } from "@/components/chat/ChatShell";

const ID_CONVERSA = /^[0-9a-f]{32}$/;

/** `?c={id}` reabre a conversa ao recarregar a página. */
export default async function Page({ searchParams }: PageProps<"/">) {
  const { c } = await searchParams;
  const id = typeof c === "string" && ID_CONVERSA.test(c) ? c : undefined;
  return <ChatShell conversaInicial={id} />;
}
