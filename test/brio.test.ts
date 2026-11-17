import { describe, expect, it, vi } from "vitest";
import { loadBrioConfig, parseFileConfig } from "../src/config.js";
import { createBrioSource } from "../src/notion/brio.js";

const ENV = { NOTION_TOKEN_BRIO: "token_brio_de_teste", NOTION_DATABASE_ID_BRIO: "0123456789abcdef0123456789abcdef" };
const file = (brio: unknown = {}) => parseFileConfig({ brio: { enabled: true, assignees: ["Ivan Freire"], statuses: ["Para puxar", "In progress"], ...(brio as object) } });
const cfg = (brio?: unknown) => loadBrioConfig(ENV, file(brio)).config!;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const schema = {
  properties: {
    Name: { type: "title" },
    status: { type: "status", status: { options: [{ name: "Para puxar" }, { name: "In progress" }, { name: "Done" }] } },
    "Atribuído para": { type: "people" },
    tipo: { type: "select", select: { options: [{ name: "epico" }, { name: "história" }] } },
    "Sub-item": { type: "relation" },
    Prioridade: { type: "select" },
  },
};
const page = (id: string, title: string, status: string, people: string[]) => ({
  object: "page",
  id,
  properties: {
    Name: { type: "title", title: [{ plain_text: title }] },
    status: { type: "status", status: { name: status } },
    "Atribuído para": { type: "people", people: people.map((name) => ({ id: name, name })) },
  },
});

function mockFetch(results: unknown[], sch = schema) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace("https://api.notion.com", "")}`;
    if (key.startsWith("GET /v1/databases/")) return json({ data_sources: [{ id: "ds-9" }] });
    if (key.startsWith("GET /v1/data_sources/")) return json(sch);
    if (key.startsWith("POST /v1/data_sources/")) return json({ results, has_more: false });
    throw new Error(`sem handler para ${key}`);
  });
}

describe("loadBrioConfig", () => {
  it("desligada por padrão e sem as variáveis", () => {
    expect(loadBrioConfig(ENV, parseFileConfig({}))).toEqual({ reason: "disabled" });
    expect(loadBrioConfig({}, file())).toEqual({ reason: "missing_env" });
    expect(loadBrioConfig({ NOTION_TOKEN_BRIO: "curto" }, file())).toEqual({ reason: "missing_env" });
  });
  it("ligada com token e database", () => {
    const c = cfg();
    expect(c.databaseId).toBe("0123456789abcdef0123456789abcdef");
    expect(c.statuses).toEqual(["para puxar", "in progress"]);
  });
  it("rejeita chaves desconhecidas e limite fora da faixa", () => {
    expect(() => parseFileConfig({ brio: { statusess: [] } })).toThrow(/config\/notion\.json/);
    expect(() => parseFileConfig({ brio: { limit: 50 } })).toThrow(/brio\.limit/);
  });
});

describe("createBrioSource", () => {
  it("filtra no servidor (status OR, sem épico, sem sub-itens), ordena por status e só devolve as do meu nome", async () => {
    const f = mockFetch([
      page("1", "Em andamento minha", "In progress", ["Ivan Freire"]),
      page("2", "De outra pessoa", "Para puxar", ["João Pedro"]),
      page("3", "Para puxar minha", "Para puxar", ["ivan  freire"]),
      page("4", "Sem responsável", "Para puxar", []),
    ]);
    const tasks = await createBrioSource(createApi(f)).fetchTasks(cfg({ excludeTypes: ["epico"], onlyWithoutSubItems: true, sortBy: "Prioridade" }));
    expect(tasks.map((t) => t.title)).toEqual(["Para puxar minha", "Em andamento minha"]); // ordem de statuses
    const body = JSON.parse(String(f.mock.calls.find(([, i]) => i?.method === "POST")![1]!.body));
    expect(body.filter.and).toEqual([
      { or: [{ property: "status", status: { equals: "Para puxar" } }, { property: "status", status: { equals: "In progress" } }] },
      { property: "tipo", select: { does_not_equal: "epico" } },
      { property: "Sub-item", relation: { is_empty: true } },
    ]);
    expect(body.sorts).toEqual([{ property: "Prioridade", direction: "ascending" }]);
    const headers = f.mock.calls.find(([, i]) => i?.method === "POST")![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token_brio_de_teste"); // usa o token do Brio, não o outro
  });

  it("propriedade ausente → NOTION_SCHEMA listando só nomes; status inexistente → erro", async () => {
    const semAssignee = { properties: { Name: { type: "title" }, status: schema.properties.status } };
    await expect(createBrioSource(createApi(mockFetch([], semAssignee as never))).fetchTasks(cfg())).rejects.toMatchObject({ code: "NOTION_SCHEMA" });
    await expect(createBrioSource(createApi(mockFetch([]))).fetchTasks(cfg({ statuses: ["Inexistente"] }))).rejects.toMatchObject({ code: "NOTION_SCHEMA" });
  });
});

import { createNotionApi } from "../src/notion/client.js";
const createApi = (f: unknown) => createNotionApi(f as typeof fetch);
