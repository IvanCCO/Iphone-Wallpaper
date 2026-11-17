import type { Hono } from "hono";
import type { AppEnv } from "./app-env.js";
import { createApp } from "./create-app.js";

/**
 * Entrada para a Vercel (zero-config Hono): o app é o `export default`.
 *
 * ATENÇÃO: o @vercel/hono escolhe como entrada o PRIMEIRO arquivo de
 *   app | index | server | src/app | src/index | src/server  (.ts/.js/...)
 * que contém `from "hono"`. Por isso:
 *  - este arquivo importa `hono` (o `import type` acima é de propósito);
 *  - a fábrica fica em `create-app.ts`, que NÃO está nessa lista. Um `src/app.ts` seria
 *    escolhido antes deste arquivo e, sem `export default`, derruba a função.
 * O `pnpm verify` reproduz essa regra.
 */
const app: Hono<AppEnv> = createApp();
export default app;
