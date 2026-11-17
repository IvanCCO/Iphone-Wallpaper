// Gera out/preview.png com tarefas fictícias, sem Notion nem token. Uso: pnpm preview [--light] [--guides]
import { mkdirSync, writeFileSync } from "node:fs";
import { dayKeyInTz, selectTasks, type Task } from "../src/domain/tasks.js";
import { renderTasksPng } from "../src/render/png.js";

const tz = "America/Sao_Paulo";
const now = new Date();
const day = (offset: number) => dayKeyInTz(new Date(now.getTime() + offset * 86_400_000), tz);
const tasks: Task[] = [
  { id: "1", title: "Pagar a fatura do cartão", done: false, priority: "high", tag: "Urgente", due: { start: day(-2), hasTime: false } },
  { id: "2", title: "Enviar relatório semanal para o time de produto", done: false, priority: "high", due: { start: day(0), hasTime: false } },
  { id: "3", title: "Reunião de planejamento", done: false, priority: "medium", tag: "Importante", due: { start: `${day(0)}T14:30:00-03:00`, hasTime: true } },
  { id: "4", title: "Comprar presente de aniversário", done: false, priority: "low", due: { start: day(2), hasTime: false } },
  { id: "5", title: "Ler capítulo do livro", done: false, priority: "none" },
  { id: "6", title: "Revisar contrato", done: true, priority: "medium", due: { start: day(0), hasTime: false } },
];

const selection = selectTasks(tasks, { view: process.argv.includes("--all") ? "all" : "pending", now, tz });
const { png } = await renderTasksPng({
  selection,
  width: 1179,
  height: 2556,
  theme: process.argv.includes("--light") ? "light" : "dark",
  tz,
  now,
  fetchedAt: now,
  limit: 8,
  safeTop: 0.4,
  safeBottom: 0.84,
  guides: process.argv.includes("--guides"),
});
mkdirSync("out", { recursive: true });
writeFileSync("out/preview.png", png);
console.log(`out/preview.png (${png.length} bytes)`);
