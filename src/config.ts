import { z } from "zod";
import { isValidCivilDate } from "./domain/life.js";
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

// ---------- Arquivo de configuração (config/notion.json) ----------

const names = z.array(z.string().min(1)).default([]);
const nameList = (fallback: string[]) => z.array(z.string().min(1)).default(fallback);

/**
 * Tudo que não é segredo vive em config/notion.json. Chaves desconhecidas são erro (pega typos).
 * Todos os campos são opcionais; os padrões servem para um database genérico de tarefas.
 */
const fileSchema = z.strictObject({
  /** Opcional: pula a descoberta do data source. */
  dataSourceId: z.string().optional(),
  /** Nomes das propriedades no Notion. Use "-" para desligar uma opcional. */
  properties: z
    .strictObject({
      title: z.string().min(1).default("Name"),
      status: z.string().min(1).default("Status"),
      due: z.string().min(1).default("Due"),
      priority: z.string().min(1).default("Priority"),
    })
    .prefault({}),
  statuses: z
    .strictObject({
      /** Se não vazio, só tarefas com estes status entram (na ordem de exibição). */
      active: names,
      /** Status que significam "concluída". */
      done: nameList(["Done", "Complete", "Completed", "Concluído", "Concluída", "Concluido", "Feito", "Finalizado"]),
    })
    .prefault({}),
  tags: z
    .strictObject({
      /** Tags a excluir (aplicadas à propriedade `properties.priority`). */
      exclude: names,
      /** Quais valores da propriedade viram prioridade alta/média/baixa (define a cor e a ordem). */
      priority: z
        .strictObject({
          high: nameList(["High", "Alta", "Alto", "Urgente", "P1"]),
          medium: nameList(["Medium", "Média", "Media", "Médio", "P2"]),
          low: nameList(["Low", "Baixa", "Baixo", "P3"]),
        })
        .prefault({}),
    })
    .prefault({}),
  /** "empty": só tarefas sem data; "any": todas. */
  dateFilter: z.enum(["any", "empty"]).default("any"),
  /** Propriedade usada para ordenar a consulta (ascendente). Padrão: a de vencimento. */
  sortBy: z.string().min(1).optional(),
  /** Progresso de vida (gráfico ao lado do título). A data de nascimento vem de BIRTH_DATE (variável de ambiente). */
  lifeProgress: z
    .strictObject({
      enabled: z.boolean().default(true),
      lifespanYears: z.number().min(1).max(130).default(84),
      style: z.enum(["pie", "bar"]).default("bar"),
    })
    .prefault({}),
  cacheTtlSeconds: z.number().min(0).default(120),
  timeoutMs: z.number().int().min(1000).default(8000),
  image: z
    .strictObject({
      timezone: z.string().min(1).default("America/Sao_Paulo"),
      /** Faixa vertical (fração da altura da imagem) onde o conteúdo é desenhado. */
      safeTop: z.number().min(0.1).max(0.6).default(0.30),
      safeBottom: z.number().min(0.5).max(0.95).default(0.735),
      /** Margem lateral (fração da largura) de cada lado. */
      marginX: z.number().min(0.03).max(0.3).default(0.125),
      /** Fator de resolução: 2 gera 2358×5112 (nítido mesmo com o zoom do iOS). */
      scale: z.number().min(1).max(3).default(2),
    })
    .prefault({}),
});

export type FileConfig = z.output<typeof fileSchema>;

export function parseFileConfig(raw: unknown): FileConfig {
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) throw configError(issuesToMessage("config/notion.json inválido", parsed.error));
  return parsed.data;
}

// ---------- Notion ----------

/** Versão fixa da API do Notion (data sources). */
export const NOTION_API_VERSION = "2025-09-03";

export interface NotionConfig {
  token: string;
  databaseId: string;
  dataSourceId?: string;
  apiVersion: string;
  props: { title: string; status: string; due: string; priority: string };
  /** Valores (normalizados) de status que significam "concluída". */
  doneStatuses: string[];
  /** Se não vazio, só tarefas com um destes status (normalizados) entram; o resto é ignorado. */
  activeStatuses: string[];
  /** Tags (normalizadas) a excluir, aplicadas à propriedade de prioridade/tag. */
  excludeTags: string[];
  dateFilter: "any" | "empty";
  sortProp?: string;
  /** Valores (normalizados) da propriedade de prioridade. */
  priorityMap: Record<Exclude<Priority, "none">, string[]>;
  cacheTtlSeconds: number;
  requestTimeoutMs: number;
}

/** Segredos/identificação vêm do ambiente; o resto vem do arquivo de configuração. */
const notionSchema = z.object({
  NOTION_TOKEN: z.string().min(10),
  NOTION_DATABASE_ID: z.string().min(10),
});

export function loadNotionConfig(env: Env, file: FileConfig): NotionConfig {
  const parsed = notionSchema.safeParse(env);
  if (!parsed.success) {
    throw configError(issuesToMessage("Variáveis do Notion ausentes ou inválidas", parsed.error));
  }
  return {
    token: parsed.data.NOTION_TOKEN,
    databaseId: parsed.data.NOTION_DATABASE_ID.replace(/-/g, ""),
    dataSourceId: file.dataSourceId?.replace(/-/g, "") || undefined,
    apiVersion: NOTION_API_VERSION,
    props: file.properties,
    doneStatuses: file.statuses.done.map(norm),
    activeStatuses: file.statuses.active.map(norm),
    excludeTags: file.tags.exclude.map(norm),
    dateFilter: file.dateFilter,
    sortProp: file.sortBy,
    priorityMap: {
      high: file.tags.priority.high.map(norm),
      medium: file.tags.priority.medium.map(norm),
      low: file.tags.priority.low.map(norm),
    },
    cacheTtlSeconds: file.cacheTtlSeconds,
    requestTimeoutMs: file.timeoutMs,
  };
}

// ---------- Padrões de imagem ----------

export interface ImageDefaults {
  tz: string;
  safeTop: number;
  safeBottom: number;
  marginX: number;
  scale: number;
}

export function loadImageDefaults(file: FileConfig): ImageDefaults {
  return { tz: file.image.timezone, safeTop: file.image.safeTop, safeBottom: file.image.safeBottom, marginX: file.image.marginX, scale: file.image.scale };
}

// ---------- Progresso de vida ----------

export interface LifeConfig {
  /** Data de nascimento YYYY-MM-DD (dado pessoal: só por variável de ambiente, nunca no repositório). */
  birthDate: string;
  lifespanYears: number;
  style: "pie" | "bar";
}

/**
 * Desligado (undefined) se `lifeProgress.enabled` é false ou se BIRTH_DATE não existe/é inválida:
 * o wallpaper continua funcionando sem o gráfico. O motivo vai em `reason` para o log.
 */
export function loadLifeConfig(env: Env, file: FileConfig): { config?: LifeConfig; reason?: string } {
  if (!file.lifeProgress.enabled) return { reason: "disabled" };
  const birth = env.BIRTH_DATE?.trim();
  if (!birth) return { reason: "no_birth_date" };
  if (!isValidCivilDate(birth)) return { reason: "invalid_birth_date" };
  return { config: { birthDate: birth, lifespanYears: file.lifeProgress.lifespanYears, style: file.lifeProgress.style } };
}
