import type { NotionConfig } from "../src/config.js";
import { loadNotionConfig } from "../src/config.js";
import type { Task } from "../src/domain/tasks.js";

export const TEST_ENV = {
  API_TOKEN: "test-token-test-token-test-token",
  NOTION_TOKEN: "secret_notion_token_for_tests",
  NOTION_DATABASE_ID: "0123456789abcdef0123456789abcdef",
};

export const notionCfg = (extra: Record<string, string> = {}): NotionConfig =>
  loadNotionConfig({ ...TEST_ENV, ...extra });

/** "Agora" fixo: 2026-11-16 12:00 em São Paulo (UTC-3). */
export const NOW = new Date("2026-11-16T15:00:00Z");
export const TZ = "America/Sao_Paulo";

export const sampleTasks: Task[] = [
  { id: "1", title: "Pagar boleto atrasado", done: false, priority: "high", due: { start: "2026-11-14", hasTime: false } },
  { id: "2", title: "Reunião com o time", done: false, priority: "medium", due: { start: "2026-11-16T14:30:00.000-03:00", hasTime: true } },
  { id: "3", title: "Enviar relatório", done: false, priority: "high", due: { start: "2026-11-16", hasTime: false } },
  { id: "4", title: "Comprar presente", done: false, priority: "low", due: { start: "2026-11-18", hasTime: false } },
  { id: "5", title: "Ler artigo", done: false, priority: "none" },
  { id: "6", title: "Tarefa feita hoje", done: true, priority: "low", due: { start: "2026-11-16", hasTime: false } },
  { id: "7", title: "Tarefa feita ontem", done: true, priority: "low", due: { start: "2026-11-15", hasTime: false } },
];
