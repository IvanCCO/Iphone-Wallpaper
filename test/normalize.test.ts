import { describe, expect, it } from "vitest";
import { normalizePage } from "../src/notion/normalize.js";
import { notionCfg } from "./fixtures.js";

const page = (props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  object: "page",
  id: "abc",
  archived: false,
  in_trash: false,
  properties: props,
  ...extra,
});
const title = (t: string) => ({ type: "title", title: [{ plain_text: t }] });

describe("normalizePage", () => {
  const cfg = notionCfg();

  it("mapeia status, prioridade e data", () => {
    const t = normalizePage(
      page({
        Name: title("Fazer X"),
        Status: { type: "status", status: { name: "Concluído" } },
        Priority: { type: "select", select: { name: "Alta" } },
        Due: { type: "date", date: { start: "2026-11-16T10:00:00.000-03:00" } },
      }),
      cfg,
    );
    expect(t).toMatchObject({ title: "Fazer X", done: true, priority: "high", due: { hasTime: true } });
  });

  it("checkbox como status", () => {
    const t = normalizePage(page({ Name: title("a"), Status: { type: "checkbox", checkbox: true } }), cfg);
    expect(t?.done).toBe(true);
  });

  it("usa a propriedade title mesmo com outro nome", () => {
    const t = normalizePage(page({ Tarefa: title("Outra") }), cfg);
    expect(t?.title).toBe("Outra");
  });

  it("ignora arquivadas, na lixeira e sem título", () => {
    expect(normalizePage(page({ Name: title("a") }, { archived: true }), cfg)).toBeUndefined();
    expect(normalizePage(page({ Name: title("a") }, { in_trash: true }), cfg)).toBeUndefined();
    expect(normalizePage(page({ Name: title("  ") }), cfg)).toBeUndefined();
  });

  it("prioridade desconhecida vira none; '-' desliga propriedades", () => {
    const t = normalizePage(page({ Name: title("a"), Priority: { type: "select", select: { name: "???" } } }), cfg);
    expect(t?.priority).toBe("none");
    const off = notionCfg({ properties: { priority: "-", due: "-", status: "-" } });
    const t2 = normalizePage(page({ Name: title("a"), Priority: { type: "select", select: { name: "Alta" } } }), off);
    expect(t2).toMatchObject({ priority: "none", done: false });
    expect(t2?.due).toBeUndefined();
  });
});

describe("activeStatuses", () => {
  const cfg = notionCfg({ statuses: { active: ["À Fazer", "Fazendo"] } });
  const st = (name: string) => ({ Name: title("a"), Status: { type: "status", status: { name } } });

  it("mantém só os status listados (ignora acento/caixa/espaços)", () => {
    expect(normalizePage(page(st("À Fazer")), cfg)).toBeDefined();
    expect(normalizePage(page(st("fazendo ")), cfg)).toBeDefined();
    expect(normalizePage(page(st("Padrões")), cfg)).toBeUndefined();
    expect(normalizePage(page(st("Feito ")), cfg)).toBeUndefined();
  });
});
