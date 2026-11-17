import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/create-app.js";
import { AppError } from "../src/errors.js";
import { silentLogger } from "../src/lib/logger.js";
import type { TaskSource } from "../src/notion/client.js";
import { NOW, sampleTasks, TEST_ENV } from "./fixtures.js";

const auth = { Authorization: `Bearer ${TEST_ENV.API_TOKEN}` };

function makeApp(source?: TaskSource, env: Record<string, string> = TEST_ENV, config: unknown = {}) {
  const taskSource = source ?? { fetchTasks: vi.fn(async () => sampleTasks) };
  const app = createApp({ env, config, taskSource, now: () => NOW, logger: silentLogger });
  return { app, taskSource };
}

describe("/health", () => {
  it("é público", async () => {
    const res = await makeApp().app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("/notion/tasks.png", () => {
  it("401 sem token, com token errado e sem vazar o token válido", async () => {
    const { app, taskSource } = makeApp();
    expect((await app.request("/notion/tasks.png")).status).toBe(401);
    const bad = await app.request("/notion/tasks.png", { headers: { Authorization: "Bearer errado" } });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain("Bearer");
    expect(taskSource.fetchTasks).not.toHaveBeenCalled();
  });

  it("200 com PNG em 2x (2358x5112) e Cache-Control privado (Bearer)", async () => {
    const res = await makeApp().app.request("/notion/tasks.png", { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    expect([png.width, png.height]).toEqual([2358, 5112]);
    const x1 = await makeApp().app.request("/notion/tasks.png?scale=1", { headers: auth });
    const p1 = PNG.sync.read(Buffer.from(await x1.arrayBuffer()));
    expect([p1.width, p1.height]).toEqual([1179, 2556]);
  });

  it("aceita ?key= (Atalhos) e mantém o cache privado", async () => {
    const res = await makeApp().app.request(`/notion/tasks.png?key=${TEST_ENV.API_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("zona segura: nada é desenhado acima de safeTop nem abaixo de safeBottom", async () => {
    const res = await makeApp().app.request("/notion/tasks.png?view=pending&scale=1", { headers: auth });
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    const bg = [png.data[0], png.data[1], png.data[2]];
    const differs = (y: number) => {
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        if (png.data[i] !== bg[0] || png.data[i + 1] !== bg[1] || png.data[i + 2] !== bg[2]) return true;
      }
      return false;
    };
    const top = Math.round(2556 * 0.30);
    const bottom = Math.round(2556 * 0.735);
    for (let y = 0; y < top - 2; y += 4) expect(differs(y), `linha ${y}`).toBe(false);
    for (let y = bottom + 2; y < 2556; y += 4) expect(differs(y), `linha ${y}`).toBe(false);
    let drawn = false;
    for (let y = top; y < bottom; y++) if (differs(y)) drawn = true;
    expect(drawn).toBe(true);
  });

  it("usa cache em memória entre requisições (TTL)", async () => {
    const { app, taskSource } = makeApp();
    await app.request("/notion/tasks.png", { headers: auth });
    await app.request("/notion/tasks.png?view=pending&priority=high", { headers: auth });
    expect(taskSource.fetchTasks).toHaveBeenCalledTimes(1);
  });

  it("TTL 0 desliga o cache", async () => {
    const { app, taskSource } = makeApp(undefined, TEST_ENV, { cacheTtlSeconds: 0 });
    await app.request("/notion/tasks.png", { headers: auth });
    await app.request("/notion/tasks.png", { headers: auth });
    expect(taskSource.fetchTasks).toHaveBeenCalledTimes(2);
  });

  it("400 para parâmetros inválidos", async () => {
    const { app } = makeApp();
    for (const q of ["scale=4", "scale=0.5", "marginX=0.9", "view=x", "width=99999", "priority=urgentissima", "tz=Marte/Base"]) {
      const res = await app.request(`/notion/tasks.png?${q}`, { headers: auth });
      expect(res.status, q).toBe(400);
    }
  });

  it("erro do Notion vira JSON sem conteúdo de tarefas e não é cacheado", async () => {
    const source: TaskSource = {
      fetchTasks: vi
        .fn<TaskSource["fetchTasks"]>()
        .mockRejectedValueOnce(new AppError("NOTION_TIMEOUT", 504, "Notion não respondeu a tempo."))
        .mockResolvedValue(sampleTasks),
    };
    const { app } = makeApp(source);
    const fail = await app.request("/notion/tasks.png", { headers: auth });
    expect(fail.status).toBe(504);
    expect(await fail.json()).toMatchObject({ error: { code: "NOTION_TIMEOUT" } });
    expect((await app.request("/notion/tasks.png", { headers: auth })).status).toBe(200);
  });

  it("sem API_TOKEN configurado falha fechado (500), nunca libera", async () => {
    const { app } = makeApp(undefined, { NOTION_TOKEN: TEST_ENV.NOTION_TOKEN, NOTION_DATABASE_ID: TEST_ENV.NOTION_DATABASE_ID });
    const res = await app.request("/notion/tasks.png");
    expect(res.status).toBe(500);
  });

  it("limita linhas: muitas tarefas mostram '+N mais' e não estouram a caixa", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      title: `Tarefa número ${i} com um título razoavelmente longo para quebrar linha no layout`,
      done: false,
      priority: "high" as const,
      due: { start: "2026-11-16", hasTime: false },
    }));
    const { app } = makeApp({ fetchTasks: async () => many });
    const res = await app.request("/notion/tasks.png?limit=12", { headers: auth });
    expect(res.status).toBe(200);
  });

  it("rota inexistente → 404 JSON", async () => {
    const res = await makeApp().app.request("/nada");
    expect(res.status).toBe(404);
  });
});

describe("gráfico de vida na rota", () => {
  const withBirth = { ...TEST_ENV, BIRTH_DATE: "2000-03-09" };
  const get = async (env: Record<string, string>, q = "") => {
    const logs: Record<string, unknown>[] = [];
    const app = createApp({
      env,
      config: {},
      taskSource: { fetchTasks: async () => sampleTasks },
      now: () => NOW,
      logger: { info: (_e, f) => void logs.push(f ?? {}), error() {} },
    });
    const res = await app.request(`/notion/tasks.png?scale=1${q}`, { headers: auth });
    return { res, log: logs.find((l) => l.path === "/notion/tasks.png") };
  };

  it("com BIRTH_DATE desenha o gráfico (pie por padrão) e loga só o estilo, nunca a data", async () => {
    const { res, log } = await get(withBirth);
    expect(res.status).toBe(200);
    expect(log?.life).toBe("pie");
    expect(JSON.stringify(log)).not.toContain("2000-03-09");
  });

  it("?lifeStyle=bar troca o estilo; ?life=0 desliga", async () => {
    expect((await get(withBirth, "&lifeStyle=bar")).log?.life).toBe("bar");
    expect((await get(withBirth, "&life=0")).log?.life).toBe("param_off");
  });

  it("sem BIRTH_DATE ou com valor inválido o wallpaper continua funcionando sem o gráfico", async () => {
    const a = await get(TEST_ENV);
    expect([a.res.status, a.log?.life]).toEqual([200, "no_birth_date"]);
    const b = await get({ ...TEST_ENV, BIRTH_DATE: "lixo" });
    expect([b.res.status, b.log?.life]).toEqual([200, "invalid_birth_date"]);
  });

  it("?lifeStyle inválido → 400", async () => {
    expect((await get(withBirth, "&lifeStyle=donut")).res.status).toBe(400);
  });
});

