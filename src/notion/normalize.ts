import { norm, type NotionConfig } from "../config.js";
import type { Priority, Task } from "../domain/tasks.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type NotionProp = any;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Valor de configuração que desliga uma propriedade opcional. */
export const DISABLED_PROP = "-";

const richText = (arr: unknown): string =>
  Array.isArray(arr) ? arr.map((t: any) => t?.plain_text ?? "").join("") : "";

function optionName(prop: NotionProp): string | undefined {
  if (!prop) return undefined;
  if (prop.type === "status") return prop.status?.name;
  if (prop.type === "select") return prop.select?.name;
  if (prop.type === "multi_select") return prop.multi_select?.[0]?.name;
  return undefined;
}

export function mapPriority(name: string | undefined, cfg: NotionConfig): Priority {
  if (!name) return "none";
  const n = norm(name);
  if (cfg.priorityMap.high.includes(n)) return "high";
  if (cfg.priorityMap.medium.includes(n)) return "medium";
  if (cfg.priorityMap.low.includes(n)) return "low";
  return "none";
}

/** Converte uma página do Notion em Task. Retorna undefined para páginas sem título útil ou na lixeira. */
export function normalizePage(page: any, cfg: NotionConfig): Task | undefined {
  if (!page || page.object !== "page" || page.archived || page.in_trash) return undefined;
  const props: Record<string, NotionProp> = page.properties ?? {};

  const titleProp =
    props[cfg.props.title]?.type === "title"
      ? props[cfg.props.title]
      : Object.values(props).find((p: NotionProp) => p?.type === "title");
  const title = richText(titleProp?.title).trim();
  if (!title) return undefined;

  // concluída?
  let done = false;
  let statusName: string | undefined;
  let statusRank: number | undefined;
  if (cfg.props.status !== DISABLED_PROP) {
    const status = props[cfg.props.status];
    if (status?.type === "checkbox") done = status.checkbox === true;
    else {
      const name = optionName(status);
      done = name !== undefined && cfg.doneStatuses.includes(norm(name));
      statusName = name?.trim() || undefined;
      if (name !== undefined) statusRank = cfg.activeStatuses.indexOf(norm(name));
      // lista de status ativos: o que estiver fora (ou sem status) não entra
      if (cfg.activeStatuses.length > 0 && !(name !== undefined && cfg.activeStatuses.includes(norm(name)))) return undefined;
    }
  }

  const tag = cfg.props.priority === DISABLED_PROP ? undefined : optionName(props[cfg.props.priority])?.trim() || undefined;
  const priority = mapPriority(tag, cfg);

  let due: Task["due"];
  if (cfg.props.due !== DISABLED_PROP) {
    const start: string | undefined = props[cfg.props.due]?.date?.start;
    if (start) due = { start, hasTime: !DATE_ONLY.test(start) };
  }

  return { id: String(page.id), title, done, priority, tag, status: statusName, statusRank: statusRank !== undefined && statusRank >= 0 ? statusRank : undefined, due };
}
