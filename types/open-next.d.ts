/** `.open-next/worker.js` só existe depois de `opennextjs-cloudflare build`. Este tipo vale quando o arquivo ainda não foi gerado. */
declare module "*/.open-next/worker.js" {
  const handler: ExportedHandler<CloudflareEnv>;
  export default handler;
}
