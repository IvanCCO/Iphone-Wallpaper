# personal-api

API pessoal em [Hono](https://hono.dev) + TypeScript, pensada para múltiplos endpoints. Sem frontend.
Primeiro endpoint: **wallpaper de iPhone com suas tarefas do Notion**, para usar com Atalhos (iOS).

Local: `/mnt/HD/Code/personal-api` (HD montado em `/mnt/HD`). Projeto independente (não relacionado ao Brio).

## Endpoints

| Rota | Auth | Descrição |
| --- | --- | --- |
| `GET /health` | não | `{ ok: true }` |
| `GET /notion/tasks.png` | **sim** | PNG 1179×2556 com as tarefas |

### `GET /notion/tasks.png`

Autenticação: `Authorization: Bearer <API_TOKEN>` (preferido) ou `?key=<API_TOKEN>` (para Atalhos; o token aparece na URL, trate-a como segredo).

| Parâmetro | Padrão | Valores |
| --- | --- | --- |
| `view` | `today` | `today` (atrasadas + hoje), `pending` (+ próximas + sem data), `all` (+ concluídas hoje) |
| `priority` | todas | `high,medium,low,none` (lista) |
| `limit` | `8` | 1–12 linhas |
| `scale` | `2` | 1–3; resolução da saída (`2` → 2358×5112, nítido mesmo com o zoom do iOS) |
| `theme` | `dark` | `dark`, `light` |
| `width` / `height` | `1179` / `2556` | 320–1500 / 640–3200 (tamanho lógico do layout) |
| `tz` | `America/Sao_Paulo` | fuso IANA |
| `safeTop` / `safeBottom` | `0.30` / `0.735` | faixa vertical (fração da altura) onde o conteúdo é desenhado |
| `marginX` | `0.125` | margem lateral de cada lado (fração da largura) |
| `brio` | `1` | `0` desliga a seção Brio |
| `life` | `1` | `0` desliga o gráfico de vida |
| `lifeStyle` | do JSON (`bar`) | `bar` (barra com caveira) ou `pie` (rosca com % dentro) |
| `guides` | `0` | `1` desenha as zonas do sistema (calibração) |

Erros são JSON `{ error: { code, message }, requestId }` e nunca contêm títulos de tarefas. Parâmetro inválido → 400, sem token → 401, falha do Notion → 502/503/504.

A imagem sai com `Cache-Control: private, no-store`: nenhuma CDN guarda a imagem e a autenticação é sempre avaliada. O cache de dados do Notion (`cacheTtlSeconds` no JSON, padrão 120 s) fica em memória, depois da autenticação.

## Rodar local

```bash
cd /mnt/HD/Code/personal-api
pnpm install
cp .env.example .env      # preencha as 3 variáveis; o resto está em config/notion.json
pnpm dev                  # http://127.0.0.1:3000

curl -H "Authorization: Bearer $API_TOKEN" localhost:3000/notion/tasks.png -o tasks.png
pnpm preview              # gera out/preview.png com dados fictícios, sem Notion
pnpm test && pnpm typecheck
```

Gere o `API_TOKEN` com `openssl rand -hex 32`.

## Configuração

Variáveis de ambiente (segredos), no `.env` local e na Vercel: `API_TOKEN`, `NOTION_TOKEN`, `NOTION_DATABASE_ID` e, para a seção Brio, `NOTION_TOKEN_BRIO` e `NOTION_DATABASE_ID_BRIO`.
Todo o resto fica em [`config/notion.json`](config/notion.json), versionado. O arquivo é validado ao iniciar; chaves desconhecidas dão erro (pega typos), e todos os campos são opcionais.

```jsonc
{
  "properties": { "title": "Name", "status": "Status", "due": "Date", "priority": "Tags" }, // "-" desliga uma opcional
  "statuses":   { "active": ["À Fazer"], "done": ["Feito"] },   // active: só esses status entram
  "tags": {
    "exclude": ["Leitura"],                                      // tags removidas
    "priority": { "high": ["Urgente"], "medium": ["Importante"], "low": ["No seu tempo"] }
  },
  "dateFilter": "empty",   // "empty" = só tarefas sem data; "any" = todas
  "sortBy": "Tags",        // ordena a consulta por esta propriedade
  "lifeProgress": { "enabled": true, "birthDate": "AAAA-MM-DD", "lifespanYears": 84, "style": "bar" },  // style: "bar" | "pie"
  "cacheTtlSeconds": 120,
  "image": { "timezone": "America/Sao_Paulo", "safeTop": 0.30, "safeBottom": 0.735, "marginX": 0.125, "scale": 2 }
}
```

Para mudar o comportamento, edite o JSON, faça commit e push (a Vercel faz o deploy sozinha).
A API não lê as views do Notion, então os filtros da sua view são replicados aqui.
A etiqueta de cada linha mostra o nome da tag do Notion; a cor vem de `tags.priority`.

### Configurar o Notion

1. Crie uma **integração interna** em <https://www.notion.so/profile/integrations>.
2. Capacidades: **somente "Read content"**.
3. No database: `•••` → **Connections** → adicione a integração.
4. `NOTION_DATABASE_ID`: trecho de 32 caracteres da URL do database (antes do `?v=`).

Se uma propriedade não bater, o erro da API lista as disponíveis. Usa a API oficial versão `2025-09-03` (data sources); fixe o `dataSourceId` no JSON para pular a descoberta.

## Deploy na Vercel (não executado ainda)

O app é detectado pelo zero-config do Hono: `src/index.ts` exporta `default` o app.

1. `pnpm dlx vercel link` dentro de `/mnt/HD/Code/personal-api` (ou importe o repositório no painel).
2. Cadastre em *Settings → Environment Variables* (Production e Preview) apenas `API_TOKEN`, `NOTION_TOKEN` e `NOTION_DATABASE_ID`. **Nunca** commite `.env`.
3. `pnpm dlx vercel deploy` (preview) → teste → `--prod`.
4. Considere ativar **Deployment Protection** apenas em previews; em produção a proteção é o `API_TOKEN`.
5. Cold start: Satori + resvg levam ~1 s na primeira chamada; as seguintes são mais rápidas. Se passar do timeout padrão, aumente `maxDuration` da função.

## Atalhos (iOS)

1. **Obter conteúdo de URL**: `https://<seu-dominio>/notion/tasks.png?view=pending&key=<API_TOKEN>`
   (ou método GET com cabeçalho `Authorization: Bearer <API_TOKEN>`).
2. **Definir imagem do papel de parede** → Tela de Bloqueio, **desligue "Mostrar visualização"/recorte** para não cortar.
3. Automação: *Hora do dia* (ex.: a cada hora) ou ao desbloquear/abrir o app.
4. Calibração: o iOS amplia o papel de parede em ~14% (centralizado) e corta as bordas; os padrões já consideram isso
   (conteúdo entre 30% e 73,5% da altura, margem de 12,5%). Abra `...&guides=1` para ver as zonas e ajuste `safeTop`/`safeBottom`/`marginX`.

### Entrada na Vercel (importante)

O `@vercel/hono` escolhe como entrada o **primeiro** arquivo de `app`, `index`, `server`, `src/app`, `src/index`, `src/server` que contém `from "hono"`. Por isso a fábrica é `src/create-app.ts` (fora da lista) e `src/index.ts` importa `hono` e faz `export default app`. Um `src/app.ts` sem `export default` derruba a função (`Invalid export found in module`).

## Validação antes do push

`pnpm install` ativa o hook `.githooks/pre-push` (via `prepare`, `git config core.hooksPath .githooks`), que roda `pnpm verify`:

1. `engines.node` com major fixa (`22.x`) e `packageManager` definido (evita upgrade automático de Node na Vercel);
2. `pnpm-lock.yaml` em sincronia com o `package.json` (a Vercel usa `--frozen-lockfile`);
3. nenhum `.env` versionado nem token do Notion/`API_TOKEN` nos arquivos;
4. `tsc --noEmit` e `vitest`;
5. entrada da Vercel (mesma regra do `@vercel/hono`), compila arquivo a arquivo, carrega no Node ESM, chama `GET /health` e renderiza um PNG.

Se algo falhar o push é bloqueado. Emergência: `SKIP_VERIFY=1 git push` (ou `--no-verify`). Rodar à mão: `pnpm verify`.

## Segurança e privacidade

- Segredos só em variáveis de ambiente; o código falha fechado sem `API_TOKEN` (HTTP 500, nunca libera).
- Tokens comparados em tempo constante; suporta rotação via `API_TOKENS=novo,antigo`.
- Logs: uma linha JSON por requisição, só método, rota (sem query), status, tempos, contagens. **Sem títulos, sem token, sem query string.**
- Cabeçalhos: `X-Content-Type-Options`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`.
- Limites nos parâmetros (tamanho, linhas) para evitar abuso de CPU.
- Pendente (não implementado): rate limit por IP/token. Na Vercel, use *Firewall → Rate Limiting*.

## Estrutura

```
src/
  index.ts            entrada Vercel (export default app; NÃO crie src/app.ts, ver abaixo)
  dev.ts              servidor Node local
  create-app.ts       fábrica do app (middlewares, /health, monta grupos de rotas)
  config.ts           validação de env + config/notion.json (zod); erros listam só nomes
  domain/tasks.ts     tipos + classificação/filtro (puro, testável)
  notion/             client (API oficial, retry, timeout) e normalização
  render/             layout (Satori) → SVG → PNG (resvg); tema; fonte Inter embutida
  routes/notion/      rotas /notion/* e parsing de parâmetros
  lib/                auth, cache TTL single-flight, logger
config/notion.json   configuração não secreta (propriedades, filtros, cache, imagem)
test/                 vitest (sem rede)
scripts/              embed-fonts (gera fonte base64), preview (PNG local)
```

Novo grupo de endpoints: crie `src/routes/<grupo>/index.ts` e monte com `app.route("/<grupo>", ...)` em `src/create-app.ts`.
Para exigir token no grupo, reutilize `requireToken` de `src/lib/auth.ts`.

## Seção "Brio" (segunda fonte do Notion)

Abaixo das tarefas aparece um divisor com o rótulo `Brio` e linhas compactas (uma linha por tarefa, status à direita) vindas de **outro workspace/token**. Os segredos ficam em `NOTION_TOKEN_BRIO` e `NOTION_DATABASE_ID_BRIO`; o resto, em `brio` no `config/notion.json`:

```jsonc
"brio": {
  "enabled": true, "label": "Brio",
  "properties": { "title": "Name", "status": "status", "assignee": "Atribuído para", "type": "tipo", "subItem": "Sub-item" },
  "statuses": ["Para puxar"],          // ordem de exibição; ex.: ["Para puxar", "In progress"]
  "assignees": ["Ivan Freire"],        // só o que está no seu nome (compara o nome, sem acento/caixa)
  "excludeTypes": ["epico"],           // tipos escondidos
  "onlyWithoutSubItems": true,         // esconde itens agrupadores (com sub-itens)
  "showStatus": true, "limit": 4, "sortBy": "Prioridade"
}
```

A API do Notion não lê views, então os filtros da view são replicados aqui. A seção reserva o espaço antes das tarefas principais. **Falha isolada:** se o outro workspace estiver fora do ar ou o token for recusado, o wallpaper sai normalmente sem a seção (o log registra só o código do erro ou a contagem, nunca títulos). A integração do Brio só precisa de "Read content" e de acesso ao database. Dados de trabalho passam por este servidor: mantenha o `API_TOKEN` em segredo.

## Progresso de vida

Ao lado direito de "Tasks" aparece quanto da vida já passou: do nascimento até o aniversário de `lifeProgress.lifespanYears` anos (padrão 84; o dia exato da morte é desconhecido). O padrão é `bar`: barra roxa sobre trilho neutro com o `%` e uma caveira desenhada em vetor. A alternativa `pie` é uma rosca com o `%` dentro. O número usa duas casas (`22.33%`), é recalculado a cada requisição (dias civis no fuso configurado + fração do dia) e muda cerca de a cada 3 dias.

A data fica em `lifeProgress.birthDate` (`AAAA-MM-DD`) no `config/notion.json`. **Atenção: é dado pessoal e o arquivo é versionado; se o repositório for público, a data de nascimento fica pública** (e no histórico do git, mesmo se apagada depois). Mantenha o repositório privado ou aceite essa exposição. Sem `birthDate` (ou com `enabled: false`) o gráfico não aparece e o wallpaper segue funcionando; data inválida é erro claro de configuração. O log registra apenas o estilo ou o motivo, nunca a data. Os testes usam só datas fictícias.

## Simulador da Tela de Bloqueio (sem deploy)

Usa o **mesmo renderizador da produção** e o `config/notion.json`, e monta uma tela de bloqueio simulada (zoom do iOS de ~14%, relógio, widgets e botões nas posições medidas num iPhone 16). Serve para calibrar sem publicar:

```bash
pnpm simulate                      # dados fictícios, sem Notion  -> out/simulator.png
pnpm simulate --live               # tarefas reais do Notion (usa o .env)
pnpm simulate --safeTop=0.28 --marginX=0.13 --zoom=1.14 --theme=light --guides
pnpm simulate --brio-statuses="Para puxar,In progress"   # status da seção Brio (--brio-status=0 esconde o status, --brio=off remove)
pnpm simulate --no-system          # só o papel de parede com o zoom, sem relógio/widgets
pnpm simulate --life=pie --birth=AAAA-MM-DD   # estilo do gráfico de vida e data (sem --birth usa o config/notion.json)
```

Gera `out/simulator.png` (tela simulada) e `out/wallpaper.png` (a imagem exata que o endpoint devolveria) e imprime um relatório com a faixa ocupada (% da altura) e avisos se o conteúdo invadir o relógio, os widgets ou encostar na borda.
Os widgets/relógio são aproximações genéricas; se o seu layout mudar, ajuste as constantes `CLOCK_BOTTOM`/`WIDGETS_TOP` e as posições em `scripts/simulate.ts`.

## Fonte

Inter (SIL OFL 1.1), embutida em base64 em `src/render/fonts.generated.ts` (gerado por `pnpm embed-fonts`), para funcionar igual local, em testes e na Vercel. Licença em `third_party/inter/LICENSE`.
