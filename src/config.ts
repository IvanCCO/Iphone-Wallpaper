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
  /** Progresso de vida (gráfico ao lado do título). Sem `birthDate` o gráfico não aparece. */
  lifeProgress: z
    .strictObject({
      enabled: z.boolean().default(true),
      /** Data de nascimento AAAA-MM-DD. ATENÇÃO: dado pessoal; se o repositório for público, ela fica pública. */
      birthDate: z.string().refine(isValidCivilDate, "use uma data válida AAAA-MM-DD").optional(),
      lifespanYears: z.number().min(1).max(130).default(84),
      style: z.enum(["pie", "bar"]).default("bar"),
    })
    .prefault({}),
  /**
   * Segunda fonte (outro workspace do Notion, outro token): seção compacta "Brio" abaixo das tarefas.
   * Segredos em NOTION_TOKEN_BRIO e NOTION_DATABASE_ID_BRIO; o resto aqui.
   */
  brio: z
    .strictObject({
      enabled: z.boolean().default(false),
      label: z.string().min(1).default("Brio"),
      properties: z
        .strictObject({
          title: z.string().min(1).default("Name"),
          status: z.string().min(1).default("status"),
          /** Propriedade de pessoas usada para filtrar "no meu nome". */
          assignee: z.string().min(1).default("Atribuído para"),
          type: z.string().min(1).default("tipo"),
          /** Relação de sub-itens (usada por onlyWithoutSubItems). */
          subItem: z.string().min(1).default("Sub-item"),
        })
        .prefault({}),
      /** Status exibidos, na ordem de exibição. */
      statuses: nameList(["Para puxar"]),
      /** Só tarefas atribuídas a estes nomes (comparação sem acento/caixa). Vazio = todas. */
      assignees: names,
      /** Tipos (propriedade `properties.type`) a excluir, ex.: ["epico"]. */
      excludeTypes: names,
      /** true = só tarefas sem sub-itens (esconde épicos agrupadores). */
      onlyWithoutSubItems: z.boolean().default(false),
      /** Mostra o status à direita de cada linha. */
      showStatus: z.boolean().default(true),
      /** Máximo de linhas (1 a 8). */
      limit: z.number().int().min(1).max(8).default(4),
      /** Propriedade usada para ordenar a consulta (ascendente), ex.: "Prioridade". */
      sortBy: z.string().min(1).optional(),
      cacheTtlSeconds: z.number().min(0).default(120),
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
  birthDate: string;
  lifespanYears: number;
  style: "pie" | "bar";
}

/**
 * Desligado (config ausente) se `lifeProgress.enabled` é false ou não há `birthDate`: o wallpaper continua
 * funcionando sem o gráfico. O motivo vai em `reason` para o log (que nunca registra a data).
 */
export function loadLifeConfig(file: FileConfig): { config?: LifeConfig; reason?: string } {
  const l = file.lifeProgress;
  if (!l.enabled) return { reason: "disabled" };
  if (!l.birthDate) return { reason: "no_birth_date" };
  return { config: { birthDate: l.birthDate, lifespanYears: l.lifespanYears, style: l.style } };
}

// ---------- Segunda fonte: Brio ----------

export interface BrioConfig {
  token: string;
  databaseId: string;
  apiVersion: string;
  requestTimeoutMs: number;
  label: string;
  props: { title: string; status: string; assignee: string; type: string; subItem: string };
  /** Status na ordem de exibição (normalizados). */
  statuses: string[];
  assignees: string[];
  excludeTypes: string[];
  onlyWithoutSubItems: boolean;
  showStatus: boolean;
  limit: number;
  sortProp?: string;
  cacheTtlSeconds: number;
}

/** Desligada (config ausente) se `brio.enabled` é false ou faltam as variáveis; o wallpaper segue sem a seção. */
export function loadBrioConfig(env: Env, file: FileConfig): { config?: BrioConfig; reason?: string } {
  const b = file.brio;
  if (!b.enabled) return { reason: "disabled" };
  const token = env.NOTION_TOKEN_BRIO?.trim();
  const databaseId = env.NOTION_DATABASE_ID_BRIO?.trim();
  if (!token || token.length < 10 || !databaseId || databaseId.length < 10) return { reason: "missing_env" };
  return {
    config: {
      token,
      databaseId: databaseId.replace(/-/g, ""),
      apiVersion: NOTION_API_VERSION,
      requestTimeoutMs: file.timeoutMs,
      label: b.label,
      props: b.properties,
      statuses: b.statuses.map(norm),
      assignees: b.assignees.map(norm),
      excludeTypes: b.excludeTypes.map(norm),
      onlyWithoutSubItems: b.onlyWithoutSubItems,
      showStatus: b.showStatus,
      limit: b.limit,
      sortProp: b.sortBy,
      cacheTtlSeconds: b.cacheTtlSeconds,
    },
  };
}
