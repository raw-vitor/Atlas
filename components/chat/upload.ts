/** Roda `fn` sobre cada item com no máximo `limite` execuções simultâneas. Nunca rejeita: devolve o resultado de cada item, na ordem. */
export async function executarComLimite<T, R>(
  itens: readonly T[], limite: number, fn: (item: T, indice: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const resultados = new Array<PromiseSettledResult<R>>(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      try { resultados[i] = { status: "fulfilled", value: await fn(itens[i], i) }; }
      catch (reason) { resultados[i] = { status: "rejected", reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, itens.length)) }, trabalhador));
  return resultados;
}

export const UPLOADS_SIMULTANEOS = 3;
