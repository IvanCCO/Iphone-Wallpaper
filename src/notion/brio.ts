import { norm, type BrioConfig } from "../config.js";
import { AppError } from "../errors.js";
import { createNotionApi, type NotionApi } from "./client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Tarefa da segunda fonte (visual compacto: título e status). */
export interface BrioTask {
  id: string;
  title: string;
  status: string;
  /** Posição do status em `statuses` (ordem de exibição). */
  statusRank: number;
}

export interface BrioSource {
  /** Busca as tarefas já filtradas e ordenadas. Nunca lança mensagens com conteúdo de tarefas. */
  fetchTasks(cfg: BrioConfig): Promise<BrioTask[]>;
}

const MAX_PAGES = 2;
const squash = (x: string) => norm(x).replace(/\s+/g, " ");
const richText = (arr: unknown): string => (Array.isArray(arr) ? arr.map((t: any) => t?.plain_text ?? "").join("") : "");

export function createBrioSource(api: NotionApi = createNotionApi()): BrioSource {
  return {
    async fetchTasks(cfg) {
      const schema = await api.resolveSchema({ ...cfg, dataSourceId: undefined });
      const p = cfg.props;
      const missing = (["title", "status", "assignee"] as const).filter((k) => !schema.properties[p[k]]);
      if (missing.length > 0) {
        throw new AppError(
          "NOTION_SCHEMA",
          502,
          `Brio: propriedades não encontradas: ${missing.map((k) => `${k}="${p[k]}"`).join(", ")}. Disponíveis: ${Object.keys(schema.properties).join(", ")}.`,
        );
      }

      // ---- filtro no servidor ----
      const clauses: unknown[] = [];
      const statusProp = schema.properties[p.status]!;
      const options: { name: string }[] = statusProp[statusProp.type]?.options ?? [];
      const wanted = cfg.statuses.flatMap((n) => options.filter((o) => norm(o.name) === n).map((o) => o.name));
      if (wanted.length === 0) throw new AppError("NOTION_SCHEMA", 502, "Brio: nenhum dos status configurados existe no database.");
      const ors = wanted.map((name) => ({ property: p.status, [statusProp.type]: { equals: name } }));
      clauses.push(ors.length === 1 ? ors[0] : { or: ors });

      const typeProp = schema.properties[p.type];
      if (typeProp && cfg.excludeTypes.length > 0 && ["select", "status", "multi_select"].includes(typeProp.type)) {
        const op = typeProp.type === "multi_select" ? "does_not_contain" : "does_not_equal";
        const topts: { name: string }[] = typeProp[typeProp.type]?.options ?? [];
        for (const o of topts.filter((o) => cfg.excludeTypes.includes(norm(o.name)))) {
          clauses.push({ property: p.type, [typeProp.type]: { [op]: o.name } });
        }
      }
      if (cfg.onlyWithoutSubItems && schema.properties[p.subItem]?.type === "relation") {
        clauses.push({ property: p.subItem, relation: { is_empty: true } });
      }

      const body: Record<string, unknown> = { page_size: 100, filter: clauses.length === 1 ? clauses[0] : { and: clauses } };
      if (cfg.sortProp && schema.properties[cfg.sortProp]) body.sorts = [{ property: cfg.sortProp, direction: "ascending" }];

      // ---- consulta ----
      const tasks: BrioTask[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await api.request(cfg, "POST", `/v1/data_sources/${schema.dataSourceId}/query`, {
          ...body,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        for (const raw of res?.results ?? []) {
          if (!raw || raw.object !== "page" || raw.archived || raw.in_trash) continue;
          const props = raw.properties ?? {};
          const title = richText(props[p.title]?.title).trim();
          const status: string | undefined = props[p.status]?.status?.name ?? props[p.status]?.select?.name;
          if (!title || !status) continue;
          // "no meu nome": a API devolve o nome das pessoas (comparação sem acento/caixa)
          if (cfg.assignees.length > 0) {
            const people: any[] = props[p.assignee]?.people ?? [];
            const wantedNames = cfg.assignees.map((a) => a.replace(/\s+/g, " "));
            if (!people.some((u) => typeof u?.name === "string" && wantedNames.includes(squash(u.name)))) continue;
          }
          const rank = cfg.statuses.indexOf(norm(status));
          tasks.push({ id: String(raw.id), title, status: status.trim(), statusRank: rank < 0 ? 99 : rank });
        }
        if (!res?.has_more || !res?.next_cursor) break;
        cursor = res.next_cursor;
      }
      // ordem de exibição: status (como configurado) e, dentro dele, a ordem devolvida pelo Notion (estável)
      return tasks.sort((a, b) => a.statusRank - b.statusRank);
    },
  };
}
