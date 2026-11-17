import { describe, expect, it } from "vitest";
import { selectTasks } from "../src/domain/tasks.js";
import { buildLayout, estimateLines } from "../src/render/layout.js";
import { NOW, sampleTasks, TZ } from "./fixtures.js";

const base = { width: 1179, height: 2556, theme: "dark" as const, tz: TZ, now: NOW, fetchedAt: NOW, limit: 8, safeTop: 0.4, safeBottom: 0.84, guides: false };

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
    expect(r.contentBox.top).toBe(Math.round(2556 * 0.4));
    expect(r.contentBox.bottom).toBe(Math.round(2556 * 0.84));
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
