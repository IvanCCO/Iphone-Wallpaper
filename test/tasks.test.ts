import { describe, expect, it } from "vitest";
import { dayKeyInTz, daysBetween, selectTasks } from "../src/domain/tasks.js";
import { NOW, sampleTasks, TZ } from "./fixtures.js";

describe("selectTasks", () => {
  it("view=today: atrasadas + hoje, sem concluídas/próximas/sem data", () => {
    const s = selectTasks(sampleTasks, { view: "today", now: NOW, tz: TZ });
    expect(s.sections.overdue.map((t) => t.id)).toEqual(["1"]);
    expect(s.sections.today.map((t) => t.id)).toEqual(["3", "2"]); // alta antes de média
    expect(s.counts).toMatchObject({ upcoming: 0, undated: 0, done: 0, total: 3 });
  });

  it("view=pending inclui próximas e sem data", () => {
    const s = selectTasks(sampleTasks, { view: "pending", now: NOW, tz: TZ });
    expect(s.sections.upcoming.map((t) => t.id)).toEqual(["4"]);
    expect(s.sections.undated.map((t) => t.id)).toEqual(["5"]);
    expect(s.counts.done).toBe(0);
  });

  it("view=all inclui só concluídas de hoje", () => {
    const s = selectTasks(sampleTasks, { view: "all", now: NOW, tz: TZ });
    expect(s.sections.done.map((t) => t.id)).toEqual(["6"]);
  });

  it("filtra por prioridade", () => {
    const s = selectTasks(sampleTasks, { view: "pending", priorities: ["high"], now: NOW, tz: TZ });
    expect(s.counts.total).toBe(2);
  });

  it("respeita o fuso: 02:00Z de 17/11 ainda é 16/11 em São Paulo", () => {
    const late = new Date("2026-11-17T02:00:00Z");
    expect(dayKeyInTz(late, TZ)).toBe("2026-11-16");
    const tasks = [{ id: "x", title: "t", done: false, priority: "none" as const, due: { start: "2026-11-16", hasTime: false } }];
    expect(selectTasks(tasks, { view: "today", now: late, tz: TZ }).sections.today).toHaveLength(1);
  });

  it("horário com offset é convertido para o dia local", () => {
    const tasks = [
      { id: "x", title: "t", done: false, priority: "none" as const, due: { start: "2026-11-17T01:00:00.000Z", hasTime: true } },
    ];
    const s = selectTasks(tasks, { view: "today", now: NOW, tz: TZ });
    expect(s.sections.today[0]?.timeLabel).toBe("22:00"); // 16/11 22:00 em SP
  });

  it("daysBetween", () => {
    expect(daysBetween("2026-11-16", "2026-11-14")).toBe(-2);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });
});
