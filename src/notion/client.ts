import { norm, type NotionConfig } from "../config.js";
import type { Task } from "../domain/tasks.js";
import { AppError } from "../errors.js";
import { TtlCache } from "../lib/cache.js";
import { DISABLED_PROP, normalizePage } from "./normalize.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TaskSource {
  /** Busca e normaliza tarefas. Nunca lança mensagens com conteúdo de tarefas. */
  fetchTasks(cfg: NotionConfig): Promise<Task[]>;
}

const API = "https://api.notion.com";
const MAX_PAGES = 3; // 3 x 100 tarefas é mais que suficiente para um wallpaper
const SCHEMA_TTL_MS = 60 * 60 * 1000;

type FetchLike = typeof fetch;

interface Schema {
  dataSourceId: string;
  properties: Record<string, { type: string; [k: string]: any }>;
}

function mapHttpError(status: number, retryAfter: string | null): AppError {
  if (status === 401) return new AppError("NOTION_AUTH", 502, "Notion recusou o token (401).");
  if (status === 403) return new AppError("NOTION_FORBIDDEN", 502, "A integração não tem acesso a este recurso (403).");
  if (status === 404)
    return new AppError(
      "NOTION_NOT_FOUND",
      502,
      "Database não encontrado. Compartilhe-o com a integração e confira NOTION_DATABASE_ID.",
    );
  if (status === 429)
    return new AppError("NOTION_RATE_LIMIT", 503, "Notion limitou as requisições (429).", {
      "Retry-After": retryAfter ?? "5",
    });
  if (status === 400) return new AppError("NOTION_BAD_REQUEST", 502, "Notion rejeitou a consulta (400).");
  return new AppError("NOTION_UPSTREAM", 502, `Falha no Notion (HTTP ${status}).`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createNotionTaskSource(fetchImpl: FetchLike = fetch): TaskSource {
  const schemaCache = new TtlCache<Schema>();

  async function request(cfg: NotionConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(`${API}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            "Notion-Version": cfg.apiVersion,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(cfg.requestTimeoutMs),
        });
      } catch (err) {
        const name = (err as Error)?.name;
        if (name === "TimeoutError" || name === "AbortError")
          throw new AppError("NOTION_TIMEOUT", 504, "Notion não respondeu a tempo.");
        throw new AppError("NOTION_NETWORK", 502, "Sem conexão com o Notion.");
      }

      if (res.ok) return res.json();

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt === 0) {
        const wait = Math.min(Number(res.headers.get("retry-after")) || 1, 3);
        await sleep(wait * 1000);
        continue;
      }
      throw mapHttpError(res.status, res.headers.get("retry-after"));
    }
  }

  async function resolveSchema(cfg: NotionConfig): Promise<Schema> {
    const { value } = await schemaCache.getOrLoad(`${cfg.databaseId}:${cfg.dataSourceId ?? ""}`, SCHEMA_TTL_MS, async () => {
      let dataSourceId = cfg.dataSourceId;
      if (!dataSourceId) {
        const db = await request(cfg, "GET", `/v1/databases/${cfg.databaseId}`);
        dataSourceId = db?.data_sources?.[0]?.id;
        if (!dataSourceId)
          throw new AppError(
            "NOTION_SCHEMA",
            502,
            "Database sem data source acessível. Defina NOTION_DATA_SOURCE_ID ou compartilhe o database com a integração.",
          );
      }
      const ds = await request(cfg, "GET", `/v1/data_sources/${dataSourceId}`);
      return { dataSourceId: dataSourceId.replace(/-/g, ""), properties: ds?.properties ?? {} };
    });
    return value;
  }

  /** Confere que as propriedades configuradas existem. Erro lista só nomes de propriedades. */
  function assertSchema(cfg: NotionConfig, schema: Schema): void {
    const names = Object.keys(schema.properties);
    const missing = (["status", "due", "priority"] as const)
      .filter((k) => cfg.props[k] !== DISABLED_PROP && !schema.properties[cfg.props[k]])
      .map((k) => `${k}="${cfg.props[k]}"`);
    if (missing.length > 0) {
      throw new AppError(
        "NOTION_SCHEMA",
        502,
        `Propriedades não encontradas: ${missing.join(", ")}. Disponíveis: ${names.join(", ")}. Ajuste "properties" em config/notion.json (use "-" para desligar).`,
      );
    }
  }

  /** Monta o filtro da consulta (status + tags excluídas + data vazia) combinado com AND. */
  function buildFilter(cfg: NotionConfig, schema: Schema): unknown | undefined {
    const clauses: unknown[] = [];

    const status = cfg.props.status === DISABLED_PROP ? undefined : schema.properties[cfg.props.status];
    if (status?.type === "checkbox") {
      clauses.push({ property: cfg.props.status, checkbox: { equals: false } });
    } else if (status?.type === "status" || status?.type === "select") {
      const options: { name: string }[] = status[status.type]?.options ?? [];
      const keep = cfg.activeStatuses.length > 0 ? options.filter((o) => cfg.activeStatuses.includes(norm(o.name))) : [];
      if (keep.length > 0) {
        const ors = keep.map((o) => ({ property: cfg.props.status, [status.type]: { equals: o.name } }));
        clauses.push(ors.length === 1 ? ors[0] : { or: ors });
      } else if (cfg.activeStatuses.length === 0) {
        for (const o of options.filter((o) => cfg.doneStatuses.includes(norm(o.name)))) {
          clauses.push({ property: cfg.props.status, [status.type]: { does_not_equal: o.name } });
        }
      }
    }

    const tagProp = cfg.props.priority === DISABLED_PROP ? undefined : schema.properties[cfg.props.priority];
    if (tagProp && cfg.excludeTags.length > 0 && ["select", "status", "multi_select"].includes(tagProp.type)) {
      const options: { name: string }[] = tagProp[tagProp.type]?.options ?? [];
      const op = tagProp.type === "multi_select" ? "does_not_contain" : "does_not_equal";
      for (const o of options.filter((o) => cfg.excludeTags.includes(norm(o.name)))) {
        clauses.push({ property: cfg.props.priority, [tagProp.type]: { [op]: o.name } });
      }
    }

    if (cfg.dateFilter === "empty" && cfg.props.due !== DISABLED_PROP) {
      clauses.push({ property: cfg.props.due, date: { is_empty: true } });
    }

    if (clauses.length === 0) return undefined;
    return clauses.length === 1 ? clauses[0] : { and: clauses };
  }

  return {
    async fetchTasks(cfg) {
      const schema = await resolveSchema(cfg);
      assertSchema(cfg, schema);

      const body: Record<string, unknown> = { page_size: 100 };
      const filter = buildFilter(cfg, schema);
      if (filter) body.filter = filter;
      const sortProp = cfg.sortProp ?? (cfg.props.due !== DISABLED_PROP ? cfg.props.due : undefined);
      if (sortProp && schema.properties[sortProp]) body.sorts = [{ property: sortProp, direction: "ascending" }];

      const tasks: Task[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await request(cfg, "POST", `/v1/data_sources/${schema.dataSourceId}/query`, {
          ...body,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        for (const raw of res?.results ?? []) {
          const task = normalizePage(raw, cfg);
          if (task) tasks.push(task);
        }
        if (!res?.has_more || !res?.next_cursor) break;
        cursor = res.next_cursor;
      }
      return tasks;
    },
  };
}
