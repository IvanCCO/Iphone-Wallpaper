import { Hono } from "hono";
import type { AppEnv } from "./app-env.js";
import { loadAuthConfig, loadImageDefaults, loadNotionConfig, type Env } from "./config.js";
import { AppError } from "./errors.js";
import { consoleLogger, type Logger } from "./lib/logger.js";
import { createNotionTaskSource, type TaskSource } from "./notion/client.js";
import { notionRoutes } from "./routes/notion/index.js";

export interface AppOptions {
  env?: Env;
  taskSource?: TaskSource;
  now?: () => Date;
  logger?: Logger;
}

/** Memoiza só sucessos: se faltar variável de ambiente, a próxima chamada tenta de novo. */
function lazy<T>(load: () => T): () => T {
  let value: { v: T } | undefined;
  return () => (value ??= { v: load() }).v;
}

/**
 * Fábrica do app. Novos grupos de endpoints entram como `app.route("/<grupo>", ...)`.
 * Recebe env/fonte/relógio por parâmetro para os testes não tocarem rede nem process.env.
 */
export function createApp(opts: AppOptions = {}): Hono<AppEnv> {
  const env = opts.env ?? (process.env as Env);
  const now = opts.now ?? (() => new Date());
  const logger = opts.logger ?? consoleLogger;

  const getAuth = lazy(() => loadAuthConfig(env));
  const getNotion = lazy(() => loadNotionConfig(env));
  const getImageDefaults = lazy(() => loadImageDefaults(env));

  const app = new Hono<AppEnv>();

  // contexto, cabeçalhos de segurança e log (sem query string, sem títulos, sem token)
  app.use("*", async (c, next) => {
    const started = performance.now();
    c.set("requestId", crypto.randomUUID());
    c.set("logFields", {});
    await next();
    c.res.headers.set("X-Request-Id", c.get("requestId"));
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Robots-Tag", "noindex, nofollow");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
    logger.info("request", {
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      ...c.get("logFields"),
    });
  });

  app.get("/health", (c) =>
    c.json({ ok: true, service: "personal-api", commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null }),
  );

  app.route(
    "/notion",
    notionRoutes({
      getAuth,
      getNotion,
      getImageDefaults,
      source: opts.taskSource ?? createNotionTaskSource(),
      now,
    }),
  );

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Rota não encontrada." } }, 404));

  app.onError((err, c) => {
    const known = err instanceof AppError;
    const code = known ? err.code : "INTERNAL";
    const status = known ? err.status : 500;
    Object.assign(c.get("logFields") ?? {}, { errorCode: code });
    if (!known) logger.error("unhandled", { requestId: c.get("requestId"), name: (err as Error)?.name });
    return c.json(
      { error: { code, message: known ? err.message : "Erro interno." }, requestId: c.get("requestId") },
      status as 400,
      known ? err.headers : {},
    );
  });

  return app;
}
