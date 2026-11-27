# Fundo escuro do Atlas (reservado para a tela de login)

Origem: `public/base.html`. Este fundo foi testado na tela de boas-vindas e retirado de lá: ela continua clara. A tela de login é o template `access/login.html` (Cloudflare Access), que já usa este fundo.
A ideia original era usá-lo numa futura tela de login, com a esfera em destaque no centro.

## Fundo

```css
background:
  radial-gradient(circle at 50% 42%, rgba(0, 185, 139, 0.14), transparent 70%),
  linear-gradient(180deg, #06110d 0%, #030806 55%);
```

No `base.html` original o brilho radial é `rgba(0,185,139,.12)` com raio fixo de `42rem`, centrado em 50% 45%. Para tela cheia, as duas versões funcionam.

No Chakra, aplicar via `css={{ background: "..." }}` no contêiner da tela.

## Esfera

```tsx
<AtlasOrb destaque fundo="escuro" tamanho={280} />
```

- `destaque`: estilo "citoesqueleto" (vizinhos k=3, junções maiores com anel, mais profundidade). Funciona em fundo claro ou escuro.
- `fundo="escuro"`: troca para `ESTADOS_ESCURO` (`components/atlas/orb/estados.ts`), com pontos claros na frente e escuros atrás, e liga a mistura aditiva (`globalCompositeOperation = "lighter"`). Só fica bom sobre fundo escuro: no claro, o aditivo lava as cores.
- O div `.atlas-orb` recebe `data-fundo="escuro"`, e `app/globals.css` já tem as auras em menta para esse caso (parado, pensando, falando e erro).
- Tamanho: 280 px em telas normais e 200 px em celular ou telas baixas. Mudar `tamanho` recria o motor, então fixe o valor no mount.

Paleta escura (igual ao `PAL` do `base.html`):

| Papel | RGB |
|---|---|
| frente | 184, 255, 231 |
| trás | 0, 92, 70 |
| núcleo (brilho) | 0, 185, 139 |
| linha | 99, 198, 165 |
| quente | 214, 255, 241 |

## Textos sobre o fundo

Cores testadas na versão do painel escuro:

- Título: `neve`.
- Texto de apoio: `nevoa`.
- Botões secundários: outline com `borderColor="menta"` e `color="menta"`, hover `rgba(99,198,165,.12)` e foco `outlineColor: "menta"`.
- Componentes que fixam `profundo` (ex.: o aviso do `ProgressMessage`) ficam ilegíveis no escuro. Ajuste a cor no componente ou force a herança com `css={{ "& p": { color: "inherit" } }}`.
- Trilha de barra de progresso: `rgba(217,227,224,.16)`.

Os contrastes não foram medidos. Confira se atingem AA antes de publicar a tela.
