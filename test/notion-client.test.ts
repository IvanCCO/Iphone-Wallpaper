import { describe, expect, it, vi } from "vitest";
import { createNotionTaskSource } from "../src/notion/client.js";
import { notionCfg } from "./fixtures.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const dsProps = {
  Name: { type: "title" },
  Status: { type: "status", status: { options: [{ name: "Todo" }, { name: "Done" }] } },
  Due: { type: "date" },
  Priority: { type: "select" },
};

function mockFetch(handlers: Record<string, () => Response>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace("https://api.notion.com", "")}`;
    const h = Object.entries(handlers).find(([k]) => key.startsWith(k));
    if (!h) throw new Error(`sem handler para ${key}`);
    return h[1]();
  });
}

describe("createNotionTaskSource", () => {
  const cfg = notionCfg();

  it("descobre o data source, filtra concluídas no servidor e normaliza", async () => {
    const f = mockFetch({
      "GET /v1/databases/": () => json({ data_sources: [{ id: "ds-1" }] }),
      "GET /v1/data_sources/ds-1": () => json({ properties: dsProps }),
      "POST /v1/data_sources/ds1/query": () =>
        json({
          results: [{ object: "page", id: "p1", properties: { Name: { type: "title", title: [{ plain_text: "A" }] } } }],
          has_more: false,
        }),
    });
    const tasks = await createNotionTaskSource(f as unknown as typeof fetch).fetchTasks(cfg);
    expect(tasks.map((t) => t.title)).toEqual(["A"]);

    const queryCall = f.mock.calls.find(([, init]) => init?.method === "POST")!;
    const body = JSON.parse(String(queryCall[1]!.body));
    expect(body.filter).toEqual({ property: "Status", status: { does_not_equal: "Done" } });
    const headers = queryCall[1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${cfg.token}`);
    expect(headers["Notion-Version"]).toBe("2025-09-03");
  });

  it("mapeia 404 e 401 para erros sem vazar conteúdo", async () => {
    const f404 = mockFetch({ "GET /v1/databases/": () => json({ message: "detalhe interno" }, 404) });
    await expect(createNotionTaskSource(f404 as unknown as typeof fetch).fetchTasks(cfg)).rejects.toMatchObject({
      code: "NOTION_NOT_FOUND",
    });
    const f401 = mockFetch({ "GET /v1/databases/": () => json({}, 401) });
    await expect(createNotionTaskSource(f401 as unknown as typeof fetch).fetchTasks(cfg)).rejects.toMatchObject({
      code: "NOTION_AUTH",
    });
  });

  it("reclama de propriedade ausente listando nomes disponíveis", async () => {
    const f = mockFetch({
      "GET /v1/databases/": () => json({ data_sources: [{ id: "ds-1" }] }),
      "GET /v1/data_sources/ds-1": () => json({ properties: { Name: { type: "title" } } }),
    });
    await expect(createNotionTaskSource(f as unknown as typeof fetch).fetchTasks(cfg)).rejects.toMatchObject({
      code: "NOTION_SCHEMA",
    });
  });

  it("falha de rede vira NOTION_NETWORK", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createNotionTaskSource(f as unknown as typeof fetch).fetchTasks(cfg)).rejects.toMatchObject({
      code: "NOTION_NETWORK",
    });
  });

  it("com NOTION_ACTIVE_STATUSES filtra no servidor por igualdade (OR)", async () => {
    const f = mockFetch({
      "GET /v1/databases/": () => json({ data_sources: [{ id: "ds-1" }] }),
      "GET /v1/data_sources/ds-1": () => json({ properties: { ...dsProps, Status: { type: "status", status: { options: [{ name: "Padrões" }, { name: "À Fazer" }, { name: "Fazendo" }, { name: "Feito " }] } } } }),
      "POST /v1/data_sources/ds1/query": () => json({ results: [], has_more: false }),
    });
    await createNotionTaskSource(f as unknown as typeof fetch).fetchTasks(notionCfg({ NOTION_ACTIVE_STATUSES: "À Fazer,Fazendo" }));
    const call = f.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(call[1]!.body)).filter).toEqual({
      or: [
        { property: "Status", status: { equals: "À Fazer" } },
        { property: "Status", status: { equals: "Fazendo" } },
      ],
    });
  });

  it("replica uma view: exclui tags, só sem data, ordena por Tags", async () => {
    const f = mockFetch({
      "GET /v1/databases/": () => json({ data_sources: [{ id: "ds-1" }] }),
      "GET /v1/data_sources/ds-1": () =>
        json({ properties: { ...dsProps, Priority: { type: "select", select: { options: [{ name: "Leitura" }, { name: "Brio" }] } } } }),
      "POST /v1/data_sources/ds1/query": () => json({ results: [], has_more: false }),
    });
    await createNotionTaskSource(f as unknown as typeof fetch).fetchTasks(
      notionCfg({ NOTION_EXCLUDE_TAGS: "leitura", NOTION_DATE_FILTER: "empty", NOTION_SORT_PROP: "Priority" }),
    );
    const body = JSON.parse(String(f.mock.calls.find(([, i]) => i?.method === "POST")![1]!.body));
    expect(body.filter.and).toEqual([
      { property: "Status", status: { does_not_equal: "Done" } },
      { property: "Priority", select: { does_not_equal: "Leitura" } },
      { property: "Due", date: { is_empty: true } },
    ]);
    expect(body.sorts).toEqual([{ property: "Priority", direction: "ascending" }]);
  });
});

