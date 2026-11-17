import { z } from "zod";
import { configError } from "./errors.js";
import type { Priority } from "./domain/tasks.js";

export type Env = Record<string, string | undefined>;

const csv = (value: string | undefined, fallback: string[]): string[] => {
  if (value === undefined || value.trim() === "") return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

/** Normaliza para comparação: minúsculas, sem acentos, sem espaços nas pontas. */
export const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

function issuesToMessage(prefix: string, error: z.ZodError): string {
  const names = error.issues.map((i) => i.path.join(".") || "(raiz)");
  return `${prefix}: ${[...new Set(names)].join(", ")}`;
}

// ---------- Autenticação do endpoint ----------

export interface AuthConfig {
  tokens: string[];
}

const MIN_TOKEN_LENGTH = 24;

/** API_TOKENS (lista separada por vírgula, permite rotação) ou API_TOKEN. Falha fechado. */
export function loadAuthConfig(env: Env): AuthConfig {
  const tokens = csv(env.API_TOKENS ?? env.API_TOKEN, []);
  if (tokens.length === 0) {
    throw configError("Defina API_TOKEN (ou API_TOKENS) no ambiente.");
  }
  if (tokens.some((t) => t.length < MIN_TOKEN_LENGTH)) {
    throw configError(`Cada token deve ter pelo menos ${MIN_TOKEN_LENGTH} caracteres.`);
  }
  return { tokens };
}

// ---------- Notion ----------

export interface NotionConfig {
  token: string;
  databaseId: string;
  /** Opcional: pula a descoberta do data source. */
  dataSourceId?: string;
  apiVersion: string;
  props: { title: string; status: string; due: string; priority: string };
  /** Valores (normalizados) de status que significam "concluída". */
  doneStatuses: string[];
  /** Se não vazio, só tarefas com um destes status (normalizados) entram; o resto é ignorado. */
  activeStatuses: string[];
  /** Tags (normalizadas) a excluir, aplicadas à propriedade de prioridade/tag (NOTION_PROP_PRIORITY). */
  excludeTags: string[];
  /** "empty": só tarefas sem data (replica uma view "Date is empty"); "any": todas. */
  dateFilter: "any" | "empty";
  /** Propriedade usada para ordenar a consulta (ascendente). Padrão: a de vencimento. */
  sortProp?: string;
  /** Valores (normalizados) do campo de prioridade. */
  priorityMap: Record<Exclude<Priority, "none">, string[]>;
  cacheTtlSeconds: number;
  requestTimeoutMs: number;
}

const notionSchema = z.object({
  NOTION_TOKEN: z.string().min(10),
  NOTION_DATABASE_ID: z.string().min(10),
});

export function loadNotionConfig(env: Env): NotionConfig {
  const parsed = notionSchema.safeParse(env);
  if (!parsed.success) {
    throw configError(issuesToMessage("Variáveis do Notion ausentes ou inválidas", parsed.error));
  }
  const ttl = Number(env.NOTION_CACHE_TTL_SECONDS ?? 120);
  const timeout = Number(env.NOTION_TIMEOUT_MS ?? 8000);
  if (!Number.isFinite(ttl) || ttl < 0 || !Number.isFinite(timeout) || timeout < 1000) {
    throw configError("NOTION_CACHE_TTL_SECONDS/NOTION_TIMEOUT_MS inválidos.");
  }
  const dateFilter = (env.NOTION_DATE_FILTER?.trim().toLowerCase() || "any") as "any" | "empty";
  if (dateFilter !== "any" && dateFilter !== "empty") throw configError("NOTION_DATE_FILTER deve ser 'any' ou 'empty'.");
  return {
    token: parsed.data.NOTION_TOKEN,
    databaseId: parsed.data.NOTION_DATABASE_ID.replace(/-/g, ""),
    dataSourceId: env.NOTION_DATA_SOURCE_ID?.replace(/-/g, "") || undefined,
    apiVersion: env.NOTION_API_VERSION?.trim() || "2025-09-03",
    props: {
      title: env.NOTION_PROP_TITLE?.trim() || "Name",
      status: env.NOTION_PROP_STATUS?.trim() || "Status",
      due: env.NOTION_PROP_DUE?.trim() || "Due",
      priority: env.NOTION_PROP_PRIORITY?.trim() || "Priority",
    },
    doneStatuses: csv(env.NOTION_DONE_STATUSES, [
      "Done",
      "Complete",
      "Completed",
      "Concluído",
      "Concluída",
      "Concluido",
      "Feito",
      "Finalizado",
    ]).map(norm),
    activeStatuses: csv(env.NOTION_ACTIVE_STATUSES, []).map(norm),
    excludeTags: csv(env.NOTION_EXCLUDE_TAGS, []).map(norm),
    dateFilter,
    sortProp: env.NOTION_SORT_PROP?.trim() || undefined,
    priorityMap: {
      high: csv(env.NOTION_PRIORITY_HIGH, ["High", "Alta", "Alto", "Urgente", "P1"]).map(norm),
      medium: csv(env.NOTION_PRIORITY_MEDIUM, ["Medium", "Média", "Media", "Médio", "P2"]).map(norm),
      low: csv(env.NOTION_PRIORITY_LOW, ["Low", "Baixa", "Baixo", "P3"]).map(norm),
    },
    cacheTtlSeconds: ttl,
    requestTimeoutMs: timeout,
  };
}

// ---------- Padrões de imagem ----------

export interface ImageDefaults {
  tz: string;
  safeTop: number;
  safeBottom: number;
}

export function loadImageDefaults(env: Env): ImageDefaults {
  const safeTop = Number(env.IMAGE_SAFE_TOP ?? 0.4);
  const safeBottom = Number(env.IMAGE_SAFE_BOTTOM ?? 0.84);
  if (!(safeTop >= 0.2 && safeTop <= 0.6) || !(safeBottom >= 0.7 && safeBottom <= 0.95)) {
    throw configError("IMAGE_SAFE_TOP deve estar em [0.2, 0.6] e IMAGE_SAFE_BOTTOM em [0.7, 0.95].");
  }
  return { tz: env.TZ_DEFAULT?.trim() || "America/Sao_Paulo", safeTop, safeBottom };
}
