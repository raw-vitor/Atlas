// Configuração do OpenNext para Cloudflare. Mínima na fase 0: sem cache incremental em R2 (o Atlas não usa ISR).
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
