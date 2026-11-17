import { Hono } from "hono";
import type { AppEnv } from "../../app-env.js";
import type { AuthConfig, ImageDefaults, NotionConfig } from "../../config.js";
import { selectTasks, type Task } from "../../domain/tasks.js";
import { TtlCache } from "../../lib/cache.js";
import { requireToken } from "../../lib/auth.js";
import type { TaskSource } from "../../notion/client.js";
import { renderTasksPng } from "../../render/png.js";
import { parseTaskImageParams } from "./params.js";

export interface NotionRouteDeps {
  getAuth: () => AuthConfig;
  getNotion: () => NotionConfig;
  getImageDefaults: () => ImageDefaults;
  source: TaskSource;
  now: () => Date;
}

interface Snapshot {
  tasks: Task[];
  fetchedAt: Date;
}

/**
 * Rotas /notion/*. Toda rota exige token.
 * Respostas: `Cache-Control: private, no-store` (nenhuma CDN guarda a imagem; a autenticação
 * é sempre avaliada). O cache de dados fica em memória, DEPOIS da autenticação.
 */
export function notionRoutes(deps: NotionRouteDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const snapshots = new TtlCache<Snapshot>();

  r.use("*", requireToken(deps.getAuth));

  r.get("/tasks.png", async (c) => {
    const params = parseTaskImageParams(c.req.query(), deps.getImageDefaults());
    const cfg = deps.getNotion();

    const t0 = performance.now();
    const { value: snap, hit } = await snapshots.getOrLoad("tasks", cfg.cacheTtlSeconds * 1000, async () => ({
      tasks: await deps.source.fetchTasks(cfg),
      fetchedAt: deps.now(),
    }));
    const notionMs = Math.round(performance.now() - t0);

    const now = deps.now();
    const selection = selectTasks(snap.tasks, { view: params.view, priorities: params.priorities, now, tz: params.tz });

    const t1 = performance.now();
    const { png, layout } = await renderTasksPng({
      selection,
      width: params.width,
      height: params.height,
      theme: params.theme,
      tz: params.tz,
      now,
      fetchedAt: snap.fetchedAt,
      limit: params.limit,
      safeTop: params.safeTop,
      safeBottom: params.safeBottom,
      guides: params.guides,
    });

    Object.assign(c.get("logFields"), {
      cache: hit,
      notionMs,
      renderMs: Math.round(performance.now() - t1),
      view: params.view,
      tasksTotal: snap.tasks.length,
      rowsShown: layout.rowsShown,
      rowsHidden: layout.rowsHidden,
      bytes: png.length,
    });

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(png.length),
        "Cache-Control": "private, no-store",
      },
    });
  });

  return r;
}
