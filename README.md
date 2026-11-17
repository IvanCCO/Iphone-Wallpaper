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
| `theme` | `dark` | `dark`, `light` |
| `width` / `height` | `1179` / `2556` | 320–1500 / 640–3200 |
| `tz` | `America/Sao_Paulo` | fuso IANA |
| `safeTop` / `safeBottom` | `0.4` / `0.84` | fração da altura onde o conteúdo começa/termina |
| `guides` | `0` | `1` desenha as zonas do sistema (calibração) |

Erros são JSON `{ error: { code, message }, requestId }` e nunca contêm títulos de tarefas. Parâmetro inválido → 400, sem token → 401, falha do Notion → 502/503/504.

A imagem sai com `Cache-Control: private, no-store`: nenhuma CDN guarda a imagem e a autenticação é sempre avaliada. O cache de dados do Notion (`NOTION_CACHE_TTL_SECONDS`, padrão 120 s) fica em memória, depois da autenticação.

## Rodar local

```bash
cd /mnt/HD/Code/personal-api
pnpm install
cp .env.example .env      # preencha API_TOKEN, NOTION_TOKEN, NOTION_DATABASE_ID
pnpm dev                  # http://127.0.0.1:3000

curl -H "Authorization: Bearer $API_TOKEN" localhost:3000/notion/tasks.png -o tasks.png
pnpm preview              # gera out/preview.png com dados fictícios, sem Notion
pnpm test && pnpm typecheck
```

Gere o `API_TOKEN` com `openssl rand -hex 32`.

## Configurar o Notion

1. Crie uma **integração interna** em <https://www.notion.so/profile/integrations>.
2. Capacidades: **somente "Read content"** (sem escrita, sem dados de usuário).
3. No database de tarefas: `•••` → **Connections** → adicione a integração.
4. `NOTION_DATABASE_ID`: é o trecho de 32 caracteres da URL do database (antes do `?v=`).
5. Ajuste `NOTION_PROP_*` se suas propriedades não se chamam `Name`, `Status`, `Due`, `Priority`.
   O erro da API lista as propriedades disponíveis quando algo não bate.

Para replicar o filtro de uma view (a API não lê views): `NOTION_ACTIVE_STATUSES` (só esses status), `NOTION_EXCLUDE_TAGS` (exclui tags), `NOTION_DATE_FILTER=empty` (só sem data) e `NOTION_SORT_PROP` (ordenação). A etiqueta de cada linha mostra o nome da tag do Notion.

Usa a API oficial versão `2025-09-03` (data sources). O `data_source_id` é descoberto a partir do database; fixe com `NOTION_DATA_SOURCE_ID` para pular essa chamada.

## Deploy na Vercel (não executado ainda)

O app é detectado pelo zero-config do Hono: `src/index.ts` exporta `default` o app.

1. `pnpm dlx vercel link` dentro de `/mnt/HD/Code/personal-api` (ou importe o repositório no painel).
2. Cadastre em *Settings → Environment Variables* (Production e Preview): `API_TOKEN`, `NOTION_TOKEN`, `NOTION_DATABASE_ID` e os opcionais de `.env.example`. **Nunca** commite `.env`.
3. `pnpm dlx vercel deploy` (preview) → teste → `--prod`.
4. Considere ativar **Deployment Protection** apenas em previews; em produção a proteção é o `API_TOKEN`.
5. Cold start: Satori + resvg levam ~1 s na primeira chamada; as seguintes são mais rápidas. Se passar do timeout padrão, aumente `maxDuration` da função.

## Atalhos (iOS)

1. **Obter conteúdo de URL**: `https://<seu-dominio>/notion/tasks.png?view=pending&key=<API_TOKEN>`
   (ou método GET com cabeçalho `Authorization: Bearer <API_TOKEN>`).
2. **Definir imagem do papel de parede** → Tela de Bloqueio, **desligue "Mostrar visualização"/recorte** para não cortar.
3. Automação: *Hora do dia* (ex.: a cada hora) ou ao desbloquear/abrir o app.
4. Calibração: abra `...&guides=1`, veja onde relógio/widgets/lanterna caem e ajuste `safeTop`/`safeBottom`.
   O padrão (`0.4`–`0.84`) assume relógio grande + widgets; no iOS 26 o relógio pode ser mais alto.

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
  index.ts            entrada Vercel (export default app)
  dev.ts              servidor Node local
  app.ts              fábrica do app (middlewares, /health, monta grupos de rotas)
  config.ts           validação de env (zod); erros listam só nomes
  domain/tasks.ts     tipos + classificação/filtro (puro, testável)
  notion/             client (API oficial, retry, timeout) e normalização
  render/             layout (Satori) → SVG → PNG (resvg); tema; fonte Inter embutida
  routes/notion/      rotas /notion/* e parsing de parâmetros
  lib/                auth, cache TTL single-flight, logger
test/                 vitest (sem rede)
scripts/              embed-fonts (gera fonte base64), preview (PNG local)
```

Novo grupo de endpoints: crie `src/routes/<grupo>/index.ts` e monte com `app.route("/<grupo>", ...)` em `src/app.ts`.
Para exigir token no grupo, reutilize `requireToken` de `src/lib/auth.ts`.

## Fonte

Inter (SIL OFL 1.1), embutida em base64 em `src/render/fonts.generated.ts` (gerado por `pnpm embed-fonts`), para funcionar igual local, em testes e na Vercel. Licença em `third_party/inter/LICENSE`.
