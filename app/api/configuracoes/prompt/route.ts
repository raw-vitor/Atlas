import { env } from "@/lib/cf";
import { deleteConfigPrompt, getConfigPrompt, putConfigPrompt } from "@/lib/rotas/configPrompt";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => getConfigPrompt(req, env());
export const PUT = (req: Request) => putConfigPrompt(req, env());
export const DELETE = (req: Request) => deleteConfigPrompt(req, env());
