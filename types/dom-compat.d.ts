/**
 * Os tipos do runtime do Workers (cloudflare-env.d.ts) e o lib "dom" do TypeScript convivem no mesmo programa. O workerd declara
 * `Body.json<T>()` sem tipo padrão, o que faz `await res.json()` virar `unknown` em todo o código do Next. Esta declaração
 * vem depois (arquivos em subpastas entram depois dos da raiz) e restaura o `any` do DOM, que é o que o código do app espera.
 */
interface Body {
  json(): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
