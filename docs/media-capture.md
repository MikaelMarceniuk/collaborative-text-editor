# Fotos e vídeos (README + LinkedIn)

Guia para gravar os screenshots, GIFs e o vídeo de demo. A ideia é gravar **um vídeo master** e gerar a partir dele a versão do README e a do LinkedIn, sem gravar duas vezes.

## Ferramentas (KDE Plasma / Wayland)

| Para quê | Ferramenta | Observação |
|---|---|---|
| Screenshot | DevTools do Chrome/Chromium | Tamanho exato e em alta resolução (ver abaixo) |
| Screenshot rápido | Spectacle (`Print`) | Já vem no KDE |
| Gravar tela | Spectacle | `Meta+Shift+R` grava uma região. Confira os atalhos em Configurações → Atalhos → Spectacle |
| Gravar com mais controle | OBS Studio (`flatpak install flathub com.obsproject.Studio`) | Só se o Spectacle não bastar |
| Cortar, comprimir, gerar GIF | `ffmpeg` | Já instalado |

## Preparar o ambiente

Fazer uma vez antes de gravar qualquer coisa.

### Dados

- Gravar no ambiente **local** (ver `docs/local-development.md`), com o banco limpo, para não aparecer documento de teste.
- Usar uma conta com o seu nome (o "Welcome, Mikael" fica bom no print).
- Criar 4 a 6 documentos com títulos reais, para a lista não parecer vazia: `World Trip — 2028`, `Reading list`, `Sprint planning`, `Recipes`, `Meeting notes`.
- O "World Trip" é o documento principal. **O editor não tem extensão de tabela**, então tire a tabela de orçamento do texto (vira texto solto).

### Navegador

- Usar um perfil limpo, sem extensões, favoritos ou abas pessoais:

  ```bash
  chromium --user-data-dir=/tmp/demo-profile --app=http://localhost:5173
  ```

  O `--app` abre sem barra de endereço e sem abas, só a página.
- **Tamanho fixo da janela: 1440×900** em tudo. No KDE dá para forçar com uma regra de janela: Configurações → Gerenciamento de janelas → Regras de janelas → Tamanho.
- Zoom do navegador em 100%. A resolução alta vem do `deviceScaleFactor` (abaixo), não do zoom.
- Esconder notificações do sistema: ativar "Não perturbe" no KDE.

## Screenshots

### Como tirar com tamanho exato

1. Abrir o DevTools (`F12`) → ícone de celular/tablet (`Ctrl+Shift+M`).
2. Escolher "Responsive", digitar **1440 × 900** e DPR **2**.
3. `Ctrl+Shift+P` → digitar "Capture screenshot" → Enter.

Sai um PNG de 2880×1800, nítido em tela retina e com o tamanho igual em todos os prints.

### Claro e escuro

Tirar cada screenshot duas vezes, uma em cada tema (botão `ThemeToggle`). O README mostra a versão que combina com o tema de quem está lendo:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/editor-dark.png">
  <img alt="Editor showing the World Trip document" src="docs/assets/editor-light.png">
</picture>
```

### Lista de screenshots

| # | Tela | Rota / componente | O que precisa aparecer |
|---|---|---|---|
| 1 | **Editor (hero)** | `/:id` com o "World Trip" (`document-editor.page.tsx`) | Header com título, "Saved", busca e tema; toolbar; títulos, listas e checklist no texto. Cursor fora da tela |
| 2 | Lista de documentos | `/` (`root.page.tsx`) | Card "Welcome, Mikael" com os 4–6 documentos |
| 3 | Sign-in | `/sign-in` | Botão "Continue as guest" visível |
| 4 | Busca e substituição | `/:id` com `Ctrl+F` aberto | Termo encontrado e destacado no texto (ex.: "Japan") |

O 1 é obrigatório. O 2 e o 4 entram como imagens menores ao lado uma da outra; o 3 pode ficar só no GIF do guest.

## GIFs (README)

GIFs curtos (5–10 s), cada um mostrando **uma** coisa. Gravar em MP4 com o Spectacle e converter depois.

| # | Nome | Roteiro |
|---|---|---|
| A | `guest-flow.gif` | `/sign-in` → "Continue as guest" → lista com o selo "Guest" → criar documento → digitar o título → editor abre |
| B | `editor.gif` | Selecionar uma frase → negrito → highlight → digitar `[ ] ` para virar checklist → o indicador vai de "Saving…" para "Saved" |
| C | `theme.gif` | No editor, alternar claro → escuro → claro (3 s) |

O A é o mais importante: mostra para o recrutador que dá para testar a demo sem criar conta.

## Vídeo master (README + LinkedIn)

### Roteiro (30–45 s)

O LinkedIn toca sem som e a maioria das pessoas para de assistir em poucos segundos. Então **começa pelo melhor**, e sem tela de carregamento.

| Tempo | Cena |
|---|---|
| 0–3 s | Editor já aberto no "World Trip", rolando devagar pelo texto |
| 3–12 s | Formatação: título, negrito, highlight, checklist sendo marcada |
| 12–18 s | `Ctrl+F` → busca "Japan" → substitui |
| 18–22 s | Alternar para o tema escuro |
| 22–35 s | Voltar para a lista → "Continue as guest" em outra janela → criar documento |
| 35–40 s | Fechar no editor, tema escuro |

Quando o tempo real estiver pronto, regravar com **duas janelas lado a lado** editando o mesmo documento. Esse passa a ser o vídeo principal.

### Dicas de gravação

- Gravar só a região da janela 1440×900 (Spectacle → região), não a tela inteira.
- Mexer o mouse **devagar** e parar o cursor perto do que vai ser clicado, porque quem assiste precisa acompanhar.
- Digitar normalmente. As partes de digitação são aceleradas depois (abaixo).
- Gravar várias tomadas curtas por cena é mais fácil do que acertar tudo de uma vez. Depois é só juntar.
- Guardar as gravações brutas **fora do repo** (ex.: `~/Videos/collaborative-editor/`).

## Pós-produção com ffmpeg

O Spectacle grava em `.webm` ou `.mp4`. Todos os comandos abaixo aceitam os dois.

### Cortar o começo e o fim

```bash
ffmpeg -ss 00:00:02 -to 00:00:15 -i raw.webm -c:v libx264 -crf 18 -an clip.mp4
```

### Acelerar um trecho de digitação (2×)

```bash
ffmpeg -i clip.mp4 -vf "setpts=0.5*PTS" -an clip-fast.mp4
```

### Juntar várias cenas

```bash
printf "file '%s'\n" cena1.mp4 cena2.mp4 cena3.mp4 > lista.txt
ffmpeg -f concat -safe 0 -i lista.txt -c copy master.mp4
```

As cenas precisam ter a mesma resolução e o mesmo fps; se forem do mesmo jeito de gravar, já têm.

### Versão LinkedIn (qualidade alta)

```bash
ffmpeg -i master.mp4 -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart -an linkedin.mp4
```

- Fazer upload **direto no LinkedIn** (não link do YouTube): vídeo nativo toca sozinho no feed.
- Escrever no post o que o vídeo mostra, porque ele toca sem som.

### Versão README (≤ 10 MB)

```bash
ffmpeg -i master.mp4 -vf "scale=1280:-2,fps=30" -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -movflags +faststart -an readme.mp4
```

Se passar de 10 MB, subir o `-crf` (30, 32…) até caber.

Para aparecer o player no README, o vídeo **não** vai no repo: arrastar o `readme.mp4` para o editor do README no site do GitHub (ou numa issue). Ele gera um link `https://github.com/user-attachments/assets/...`, que é colado sozinho numa linha do markdown.

### GIF a partir de um clipe

```bash
ffmpeg -i clip.mp4 -vf "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0 guest-flow.gif
```

- `palettegen` + `paletteuse` gera uma paleta de cores própria do clipe. Sem isso o GIF fica granulado.
- Alvo: até ~5 MB por GIF. Se passar, baixar para `fps=12` ou `scale=800`.

## Onde salvar no repo

```
docs/assets/
  editor-light.png
  editor-dark.png
  documents-light.png
  documents-dark.png
  search-light.png
  search-dark.png
  guest-flow.gif
  editor.gif
  theme.gif
```

O vídeo fica fora do repo (no `user-attachments` do GitHub, como explicado acima).

## Checklist

- [ ] Ambiente local rodando com o banco limpo
- [ ] Conta criada e 4–6 documentos com títulos reais
- [ ] "World Trip" sem a tabela
- [ ] Perfil limpo do navegador, janela 1440×900, "Não perturbe" ligado
- [ ] Screenshots 1–4 (claro e escuro)
- [ ] GIFs A, B e C
- [ ] Vídeo master → `linkedin.mp4` e `readme.mp4`
- [ ] Imagens em `docs/assets/`, vídeo no `user-attachments`
