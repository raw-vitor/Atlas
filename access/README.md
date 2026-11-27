# Tela de login do Cloudflare Access

`login.html` é o template HTML + Liquid da tela de login do Atlas. Referência visual: `public/login-preview.html`.

## Como publicar

Exige plano Zero Trust Pay-as-you-go ou Enterprise (não existe no Free).

1. Zero Trust > Reusable components > Custom pages > Access custom pages > Create custom page.
2. Nome único, tipo **Login**. Cole o conteúdo de `login.html`.
3. Confira **Problems** e **Variables**, depois **Publish**.
4. Na aplicação do Atlas: Access controls > Applications > Additional settings > Login page > Custom page, escolha o template e salve.

Teste primeiro numa aplicação isolada. Publicar uma edição altera o template para todas as aplicações que o usam.

## Regras do template

- Exatamente um `<cf-access-authbox></cf-access-authbox>`, visível e fora de condições Liquid.
- Sem JavaScript, sem handlers inline, sem assets do próprio Atlas (ficam atrás do Access). Só CSS inline em `<style>`.
- `{{ message.text }}` precisa continuar visível.

`tests/access.template.test.ts` confere essas regras.

## Ver localmente

O editor do Cloudflare não tem preview. Para ver o layout, abra `access/login.html` no navegador. O authbox não renderiza fora do Access e o bloco `{% if %}` aparece como texto; a conferência final é na aplicação de teste.
