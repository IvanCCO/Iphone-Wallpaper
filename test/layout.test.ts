import { describe, expect, it } from "vitest";
import { selectTasks } from "../src/domain/tasks.js";
import { buildLayout, estimateLines } from "../src/render/layout.js";
import { NOW, sampleTasks, TZ } from "./fixtures.js";

const base = { width: 1179, height: 2556, theme: "dark" as const, tz: TZ, now: NOW, fetchedAt: NOW, limit: 8, safeTop: 0.30, safeBottom: 0.735, marginX: 0.125, guides: false };

describe("buildLayout", () => {
  it("respeita limit e reporta ocultas", () => {
    const sel = selectTasks(sampleTasks, { view: "pending", now: NOW, tz: TZ });
    const r = buildLayout({ ...base, selection: sel, limit: 2 });
    expect(r.rowsShown).toBe(2);
    expect(r.rowsHidden).toBe(sel.counts.total - 2);
  });

  it("conteúdo dentro da zona segura", () => {
    const sel = selectTasks(sampleTasks, { view: "pending", now: NOW, tz: TZ });
    const r = buildLayout({ ...base, selection: sel });
    expect(r.contentBox.top).toBe(Math.round(2556 * 0.30));
    expect(r.contentBox.bottom).toBe(Math.round(2556 * 0.735));
    expect(r.contentBox.left).toBe(Math.round(1179 * 0.125));
    expect(r.contentBox.right).toBe(1179 - Math.round(1179 * 0.125));
  });

  it("estado vazio não quebra", () => {
    const sel = selectTasks([], { view: "today", now: NOW, tz: TZ });
    expect(buildLayout({ ...base, selection: sel }).rowsShown).toBe(0);
  });

  it("estimateLines limita a 2", () => {
    expect(estimateLines("a".repeat(500), 42, 900)).toBe(2);
    expect(estimateLines("curto", 42, 900)).toBe(1);
  });
});

describe("agrupamento por status", () => {
  it("só sem data + status: agrupa na ordem de statusRank, À Fazer antes de Fazendo", () => {
    const mk = (id: string, status: string, statusRank: number) => ({ id, title: id, done: false, priority: "none" as const, status, statusRank });
    const sel = selectTasks([mk("b", "Fazendo", 1), mk("a", "À Fazer", 0), mk("c", "À Fazer", 0)], { view: "pending", now: NOW, tz: TZ });
    const r = buildLayout({ ...base, selection: sel });
    const text = JSON.stringify(r.root);
    expect(text.indexOf("À Fazer")).toBeLessThan(text.indexOf("Fazendo"));
    expect(text).toContain("À Fazer  ·  2");
    expect(r.rowsShown).toBe(3);
  });
});

describe("cabeçalho simples", () => {
  const mk = (id: string) => ({ id, title: id, done: false, priority: "none" as const, status: "À Fazer", statusRank: 0 });
  const render = (n: number) => {
    const sel = selectTasks(Array.from({ length: n }, (_, i) => mk(`t${i}`)), { view: "pending", now: NOW, tz: TZ });
    return JSON.stringify(buildLayout({ ...base, selection: sel }).root);
  };

  it('título "Tasks" e subtítulo "Atualizado em dd/mm hh:mm · N tasks"', () => {
    const text = render(4);
    expect(text).toContain('"Tasks"');
    expect(text).toMatch(/Atualizado em 16\/11 12:00 · 4 tasks/);
    expect(render(1)).toMatch(/· 1 task"/);
  });

  it("sem rodapé, sem data por extenso e sem cabeçalho de seção quando há um só status", () => {
    const text = render(3);
    expect(text).not.toContain("pendentes");
    expect(text).not.toContain("Segunda-feira");
    expect(text).not.toContain("À Fazer  ·");
  });
});

describe("gráfico de vida", () => {
  const sel = selectTasks(sampleTasks, { view: "pending", now: NOW, tz: TZ });
  const render = (life?: { fraction: number; style: "pie" | "bar" }) => JSON.stringify(buildLayout({ ...base, selection: sel, life }).root);

  it("pie mostra o percentual dentro e usa imagem de rosca", () => {
    const t = render({ fraction: 0.2233, style: "pie" });
    expect(t).toContain("22.33%");
    expect(t).toContain("data:image/svg+xml;base64,");
  });

  it("bar mostra o percentual e a caveira", () => {
    const t = render({ fraction: 0.5, style: "bar" });
    expect(t).toContain("50.00%");
    expect(Buffer.from(t.match(/base64,([A-Za-z0-9+/=]+)/)![1]!, "base64").toString()).toContain("<svg");
  });

  it("sem life não há gráfico", () => {
    expect(render()).not.toContain("%\"");
    expect(render()).not.toContain("data:image/svg+xml");
  });
});

