import type { Metadata } from "next";
import { idConversaValido } from "@/components/chat/configPrompt";
import { PromptEditor } from "@/components/config/PromptEditor";

export const metadata: Metadata = {
  title: "Suas instruções · Atlas",
  description: "Ajuste como o Atlas trata os dados do lead e escreve os slides da R2.",
};

/** `?voltar={id}` leva de volta à conversa aberta; só vale um id de 32 hex. */
export default async function Page({ searchParams }: PageProps<"/configuracoes/prompt">) {
  const { voltar } = await searchParams;
  return <PromptEditor voltarId={idConversaValido(voltar) ? voltar : undefined} />;
}
