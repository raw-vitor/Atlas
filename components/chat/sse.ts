/** Lê uma resposta SSE (`event:` + `data:`) pelo fetch e chama `aoEvento` para cada evento. */
export async function lerSSE(r: Response, aoEvento: (evento: string, dados: unknown) => void): Promise<void> {
  const leitor = r.body!.getReader();
  const dec = new TextDecoder();
  let resto = "";
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    let i: number;
    while ((i = resto.indexOf("\n\n")) >= 0) {
      const bloco = resto.slice(0, i); resto = resto.slice(i + 2);
      let evento = "message", dados = "";
      for (const l of bloco.split("\n")) {
        if (l.startsWith("event: ")) evento = l.slice(7);
        else if (l.startsWith("data: ")) dados += l.slice(6);
      }
      if (dados) aoEvento(evento, JSON.parse(dados));
    }
  }
}
