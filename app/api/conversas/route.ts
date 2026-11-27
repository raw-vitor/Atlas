import { env } from "@/lib/cf";
import { getConversas, postConversas } from "@/lib/rotas/conversas";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => getConversas(req, env());
export const POST = (req: Request) => postConversas(req, env());
