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

Só **3 variáveis de ambiente** (segredos), no `.env` local e na Vercel: `API_TOKEN`, `NOTION_TOKEN`, `NOTION_DATABASE_ID`.
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
  "cacheTtlSeconds": 120,
  "image": { "timezone": "America/Sao_Paulo", "safeTop": 0.4, "safeBottom": 0.84 }
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
4. Calibração: abra `...&guides=1`, veja onde relógio/widgets/lanterna caem e ajuste `safeTop`/`safeBottom`.
   O padrão (`0.4`–`0.84`) assume relógio grande + widgets; no iOS 26 o relógio pode ser mais alto.

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

## Fonte

Inter (SIL OFL 1.1), embutida em base64 em `src/render/fonts.generated.ts` (gerado por `pnpm embed-fonts`), para funcionar igual local, em testes e na Vercel. Licença em `third_party/inter/LICENSE`.
