export type Priority = "high" | "medium" | "low" | "none";
export type View = "today" | "pending" | "all";
export type Bucket = "overdue" | "today" | "upcoming" | "undated" | "done";

export interface Task {
  id: string;
  title: string;
  done: boolean;
  priority: Priority;
  /** Nome do status no Notion (ex.: "À Fazer") e sua posição em statuses.active (ordem de exibição). */
  status?: string;
  statusRank?: number;
  /** Nome original da tag/prioridade no Notion (ex.: "Urgente"), exibido na etiqueta. */
  tag?: string;
  /** `start` como veio do Notion: "YYYY-MM-DD" ou ISO com horário/offset. */
  due?: { start: string; hasTime: boolean };
}

export interface TaskItem extends Task {
  bucket: Bucket;
  /** Dia do vencimento (YYYY-MM-DD) no fuso pedido. */
  dueKey?: string;
  /** "HH:mm" quando o vencimento tem horário. */
  timeLabel?: string;
  /** dueKey - hoje, em dias (negativo = atrasada). */
  daysDiff?: number;
}

export interface Selection {
  sections: Record<Bucket, TaskItem[]>;
  counts: Record<Bucket, number> & { total: number };
}

export const BUCKET_ORDER: Bucket[] = ["overdue", "today", "upcoming", "undated", "done"];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Dia civil (YYYY-MM-DD) de um instante no fuso `tz`. */
export function dayKeyInTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Dia do vencimento no fuso `tz`. Datas sem horário não sofrem conversão de fuso. */
export function dueDayKey(start: string, tz: string): string | undefined {
  if (DATE_ONLY.test(start)) return start;
  const d = new Date(start);
  return Number.isNaN(d.getTime()) ? undefined : dayKeyInTz(d, tz);
}

export function dueTimeLabel(start: string, tz: string): string | undefined {
  if (DATE_ONLY.test(start)) return undefined;
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

export function daysBetween(fromKey: string, toKey: string): number {
  const ms = (k: string) => {
    const [y, m, d] = k.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(toKey) - ms(fromKey)) / 86_400_000);
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };

export interface SelectOptions {
  view: View;
  /** Se informado e não vazio, mantém só estas prioridades. */
  priorities?: Priority[];
  now: Date;
  tz: string;
}

/**
 * Classifica e filtra tarefas.
 * - today:   atrasadas + hoje (não concluídas)
 * - pending: atrasadas + hoje + próximas + sem data (não concluídas)
 * - all:     pending + concluídas com vencimento hoje
 */
export function selectTasks(tasks: Task[], opts: SelectOptions): Selection {
  const today = dayKeyInTz(opts.now, opts.tz);
  const wanted = opts.priorities && opts.priorities.length > 0 ? new Set(opts.priorities) : undefined;

  const sections: Selection["sections"] = { overdue: [], today: [], upcoming: [], undated: [], done: [] };

  for (const task of tasks) {
    if (wanted && !wanted.has(task.priority)) continue;

    const dueKey = task.due ? dueDayKey(task.due.start, opts.tz) : undefined;
    const item: TaskItem = {
      ...task,
      bucket: "undated",
      dueKey,
      timeLabel: task.due?.hasTime ? dueTimeLabel(task.due.start, opts.tz) : undefined,
      daysDiff: dueKey ? daysBetween(today, dueKey) : undefined,
    };

    if (task.done) {
      if (opts.view === "all" && dueKey === today) {
        item.bucket = "done";
        sections.done.push(item);
      }
      continue;
    }
    if (!dueKey) item.bucket = "undated";
    else if (dueKey < today) item.bucket = "overdue";
    else if (dueKey === today) item.bucket = "today";
    else item.bucket = "upcoming";

    if (opts.view === "today" && item.bucket !== "overdue" && item.bucket !== "today") continue;
    sections[item.bucket].push(item);
  }

  const byPriority = (a: TaskItem, b: TaskItem) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  const byTitle = (a: TaskItem, b: TaskItem) => a.title.localeCompare(b.title, "pt-BR");
  const byDay = (a: TaskItem, b: TaskItem) => (a.dueKey ?? "").localeCompare(b.dueKey ?? "");
  // string vazia ("sem horário") vem depois de qualquer horário
  const byTime = (a: TaskItem, b: TaskItem) =>
    (a.timeLabel ?? "99:99").localeCompare(b.timeLabel ?? "99:99");

  sections.overdue.sort((a, b) => byPriority(a, b) || byDay(a, b) || byTitle(a, b));
  sections.today.sort((a, b) => byPriority(a, b) || byTime(a, b) || byTitle(a, b));
  sections.upcoming.sort((a, b) => byDay(a, b) || byPriority(a, b) || byTitle(a, b));
  // empate: mantém a ordem recebida do Notion (sort é estável)
  sections.undated.sort((a, b) => (a.statusRank ?? 0) - (b.statusRank ?? 0) || byPriority(a, b));
  sections.done.sort(byTitle);

  const counts = {
    overdue: sections.overdue.length,
    today: sections.today.length,
    upcoming: sections.upcoming.length,
    undated: sections.undated.length,
    done: sections.done.length,
    total: 0,
  };
  counts.total = counts.overdue + counts.today + counts.upcoming + counts.undated + counts.done;
  return { sections, counts };
}
