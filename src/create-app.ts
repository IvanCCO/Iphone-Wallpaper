import { Hono } from "hono";
import type { AppEnv } from "./app-env.js";
import rawFileConfig from "../config/notion.json" with { type: "json" };
import { loadAuthConfig, loadBrioConfig, loadImageDefaults, loadLifeConfig, loadNotionConfig, parseFileConfig, type Env } from "./config.js";
import { AppError } from "./errors.js";
import { consoleLogger, type Logger } from "./lib/logger.js";
import { createBrioSource, type BrioSource } from "./notion/brio.js";
import { createNotionTaskSource, type TaskSource } from "./notion/client.js";
import { notionRoutes } from "./routes/notion/index.js";

export interface AppOptions {
  env?: Env;
  /** Conteúdo de config/notion.json (padrão: o arquivo do projeto). Útil em testes. */
  config?: unknown;
  taskSource?: TaskSource;
  brioSource?: BrioSource;
  now?: () => Date;
  logger?: Logger;
}

/** Apenas o que usamos de uma resposta HTTP. */
interface ResponseLike {
  status: number;
  headers: { set(name: string, value: string): void; has(name: string): boolean };
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
  const getFile = lazy(() => parseFileConfig(opts.config ?? rawFileConfig));
  const getNotion = lazy(() => loadNotionConfig(env, getFile()));
  const getImageDefaults = lazy(() => loadImageDefaults(getFile()));
  const getLife = lazy(() => loadLifeConfig(getFile()));
  const getBrio = lazy(() => loadBrioConfig(env, getFile()));

  const app = new Hono<AppEnv>();

  // contexto, cabeçalhos de segurança e log (sem query string, sem títulos, sem token)
  app.use("*", async (c, next) => {
    const started = performance.now();
    c.set("requestId", crypto.randomUUID());
    c.set("logFields", {});
    await next();
    // Tipo estrutural local: não depende de como o ambiente de build resolve o `Response` global
    // (o typecheck da Vercel roda com um tsconfig temporário e já falhou aqui).
    const res = c.res as unknown as ResponseLike;
    res.headers.set("X-Request-Id", c.get("requestId"));
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    res.headers.set("Referrer-Policy", "no-referrer");
    if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
    logger.info("request", {
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status: res.status,
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
      getLife,
      getBrio,
      source: opts.taskSource ?? createNotionTaskSource(),
      brioSource: opts.brioSource ?? createBrioSource(),
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
