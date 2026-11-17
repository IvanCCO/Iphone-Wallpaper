import { Hono } from "hono";
import type { AppEnv } from "../../app-env.js";
import type { AuthConfig, BrioConfig, ImageDefaults, LifeConfig, NotionConfig } from "../../config.js";
import { lifeProgress } from "../../domain/life.js";
import { selectTasks, type Task } from "../../domain/tasks.js";
import { TtlCache } from "../../lib/cache.js";
import { requireToken } from "../../lib/auth.js";
import type { BrioSource, BrioTask } from "../../notion/brio.js";
import type { TaskSource } from "../../notion/client.js";
import { renderTasksPng } from "../../render/png.js";
import { parseTaskImageParams } from "./params.js";

export interface NotionRouteDeps {
  getAuth: () => AuthConfig;
  getNotion: () => NotionConfig;
  getImageDefaults: () => ImageDefaults;
  /** Config do gráfico de vida; `config` ausente = desligado (com `reason` para o log). */
  getLife: () => { config?: LifeConfig; reason?: string };
  /** Segunda fonte (Brio); `config` ausente = seção desligada. */
  getBrio: () => { config?: BrioConfig; reason?: string };
  source: TaskSource;
  brioSource: BrioSource;
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
  const brioSnapshots = new TtlCache<BrioTask[]>();

  r.use("*", requireToken(deps.getAuth));

  r.get("/tasks.png", async (c) => {
    const params = parseTaskImageParams(c.req.query(), deps.getImageDefaults());
    const cfg = deps.getNotion();

    // Seção "Brio": busca em paralelo e com falha isolada (se o outro workspace falhar, o wallpaper sai sem ela)
    const brioCfg = params.brio ? deps.getBrio() : { reason: "param_off" as const };
    const tb = performance.now();
    const brioResult: Promise<{ tasks: BrioTask[] } | { error: string } | undefined> = brioCfg.config
      ? brioSnapshots
          .getOrLoad("brio", brioCfg.config.cacheTtlSeconds * 1000, () => deps.brioSource.fetchTasks(brioCfg.config!))
          .then(
            (r) => ({ tasks: r.value }),
            (e: unknown) => ({ error: (e as { code?: string })?.code ?? "UNKNOWN" }),
          )
      : Promise.resolve(undefined);

    const t0 = performance.now();
    const { value: snap, hit } = await snapshots.getOrLoad("tasks", cfg.cacheTtlSeconds * 1000, async () => ({
      tasks: await deps.source.fetchTasks(cfg),
      fetchedAt: deps.now(),
    }));
    const notionMs = Math.round(performance.now() - t0);

    const now = deps.now();
    const lifeCfg = params.life ? deps.getLife() : { reason: "param_off" };
    const life = lifeCfg.config
      ? { fraction: lifeProgress(lifeCfg.config.birthDate, lifeCfg.config.lifespanYears, now, params.tz), style: params.lifeStyle ?? lifeCfg.config.style }
      : undefined;
    const brioRes = await brioResult;
    const brioMs = Math.round(performance.now() - tb);
    const brioItems = brioRes && "tasks" in brioRes && brioCfg.config ? brioRes.tasks : [];
    const brio =
      brioCfg.config && brioItems.length > 0
        ? {
            label: brioCfg.config.label,
            items: brioItems.slice(0, brioCfg.config.limit).map((t) => ({ title: t.title, status: brioCfg.config!.showStatus ? t.status : undefined })),
            hidden: Math.max(0, brioItems.length - brioCfg.config.limit),
          }
        : undefined;
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
      marginX: params.marginX,
      scale: params.scale,
      life,
      brio,
      guides: params.guides,
    });

    Object.assign(c.get("logFields"), {
      cache: hit,
      notionMs,
      renderMs: Math.round(performance.now() - t1),
      view: params.view,
      life: life ? life.style : (lifeCfg.reason ?? null),
      brio: brioRes ? ("tasks" in brioRes ? brioItems.length : brioRes.error) : (brioCfg.reason ?? null),
      brioMs: brioRes ? brioMs : null,
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
