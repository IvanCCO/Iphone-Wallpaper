// Simulador de Tela de Bloqueio. Usa o MESMO renderizador da produção (renderTasksPng) e config/notion.json.
//
//   pnpm simulate                 dados fictícios (sem Notion), salva out/simulator.png
//   pnpm simulate --live          busca as tarefas reais do Notion (usa o .env)
//   pnpm simulate --zoom=1.14     zoom que o iOS aplica ao papel de parede (calibrado no print do iPhone 16)
//   pnpm simulate --safeTop=0.28 --safeBottom=0.74 --marginX=0.13 --theme=light --guides
//   pnpm simulate --life=bar      gráfico de vida em barra (padrão: o de config/notion.json; --life=off desliga)
//   pnpm simulate --birth=AAAA-MM-DD   data de nascimento (padrão: lifeProgress.birthDate do config/notion.json)
//   pnpm simulate --brio-statuses="Para puxar,In progress"   status da seção Brio (padrão: config/notion.json); --brio-status=0 esconde o status; --brio=off remove a seção
//   pnpm simulate --no-system     mostra só o papel de parede (com o zoom), sem relógio/widgets
//
// Saídas: out/simulator.png (tela simulada) e out/wallpaper.png (a imagem exata que o endpoint devolveria).
import { mkdirSync, writeFileSync } from "node:fs";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import rawFileConfig from "../config/notion.json" with { type: "json" };
import { loadBrioConfig, loadImageDefaults, loadLifeConfig, loadNotionConfig, parseFileConfig } from "../src/config.js";
import { formatPercent, isValidCivilDate, lifeProgress } from "../src/domain/life.js";
import { dayKeyInTz, selectTasks, type Task } from "../src/domain/tasks.js";
import { createBrioSource } from "../src/notion/brio.js";
import { createNotionTaskSource } from "../src/notion/client.js";
import { getFonts, renderTasksPng } from "../src/render/png.js";

// ---------- argumentos ----------
const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1]!, m[2] ?? "1");
}
const num = (k: string, d: number) => (args.has(k) ? Number(args.get(k)) : d);

const file = parseFileConfig(rawFileConfig);
const d = loadImageDefaults(file);
const tz = args.get("tz") ?? d.tz;
const zoom = num("zoom", 1.14);
const safeTop = num("safeTop", d.safeTop);
const safeBottom = num("safeBottom", d.safeBottom);
const marginX = num("marginX", d.marginX);
const scale = num("scale", d.scale);
const theme = (args.get("theme") ?? "dark") as "dark" | "light";
const W = 1179;
const H = 2556;

// ---------- tarefas ----------
const now = new Date();
let tasks: Task[];
if (args.has("live")) {
  tasks = await createNotionTaskSource().fetchTasks(loadNotionConfig(process.env, file));
} else {
  const sample = (id: string, title: string, tag: string, priority: Task["priority"]): Task => ({
    id, title, done: false, priority, tag, status: file.statuses.active[0] ?? "À Fazer", statusRank: 0,
  });
  tasks = [
    sample("1", "Renovar o certificado do site", "Urgente", "high"),
    sample("2", "Configurar o gerenciador de senhas", "Importante", "medium"),
    sample("3", "Responder o e-mail do professor sobre o trabalho final", "Normal", "none"),
    sample("4", "Escrever o post do blog sobre livros", "Normal", "none"),
  ];
}
const selection = selectTasks(tasks, { view: "pending", now, tz });

// ---------- seção Brio ----------
const brioOff = args.get("brio") === "off";
const brioFile = {
  ...file,
  brio: {
    ...file.brio,
    ...(args.has("brio-statuses") ? { statuses: args.get("brio-statuses")!.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
    ...(args.has("brio-status") ? { showStatus: args.get("brio-status") !== "0" } : {}),
  },
};
let brio: { label: string; items: { title: string; status?: string }[]; hidden: number } | undefined;
let brioNote = "";
if (!brioOff && brioFile.brio.enabled) {
  const loaded = loadBrioConfig(args.has("live") ? process.env : { NOTION_TOKEN_BRIO: "simulado-simulado", NOTION_DATABASE_ID_BRIO: "simulado-simulado" }, brioFile);
  if (loaded.config) {
    let items: { title: string; status: string }[];
    if (args.has("live")) {
      items = (await createBrioSource().fetchTasks(loaded.config)).map((t) => ({ title: t.title, status: t.status }));
    } else {
      // dados fictícios: distribui entre os status configurados
      const st = brioFile.brio.statuses;
      const titles = ["Criar estrutura da lista de exercícios", "Colocar as apostilas no novo formato", "Configurar dashboards e alertas centralizados com grafana", "Ter todos os conteúdos com apostilas de geografia", "Revisar o fluxo de onboarding"];
      items = titles.map((title, i) => ({ title, status: st[Math.min(st.length - 1, Math.floor(i / 2))] ?? "Para puxar" }));
    }
    const shown = items.slice(0, loaded.config.limit);
    brio = { label: loaded.config.label, items: shown.map((t) => ({ title: t.title, status: loaded.config!.showStatus ? t.status : undefined })), hidden: items.length - shown.length };
    brioNote = `Brio: ${items.length} tasks (${brioFile.brio.statuses.join(", ")}) ${args.has("live") ? "ao vivo" : "fictícias"}`;
  } else {
    brioNote = `Brio: sem seção (${loaded.reason})`;
  }
}

// ---------- progresso de vida ----------
const lifeArg = args.get("life");
const birthArg = args.get("birth");
if (birthArg && !isValidCivilDate(birthArg)) throw new Error("--birth deve ser uma data válida AAAA-MM-DD");
const lifeFile = birthArg ? { ...file, lifeProgress: { ...file.lifeProgress, birthDate: birthArg } } : file;
const lifeLoaded = loadLifeConfig(lifeFile);
let life: { fraction: number; style: "pie" | "bar" } | undefined;
if (lifeArg !== "off" && lifeLoaded.config) {
  life = {
    fraction: lifeProgress(lifeLoaded.config.birthDate, lifeLoaded.config.lifespanYears, now, tz),
    style: lifeArg === "bar" || lifeArg === "pie" ? lifeArg : lifeLoaded.config.style,
  };
}

// ---------- papel de parede (exatamente o que o endpoint devolve) ----------
const { png: wallpaper, layout } = await renderTasksPng({
  selection, width: W, height: H, theme, tz, now, fetchedAt: now, limit: 8,
  safeTop, safeBottom, marginX, life, brio, guides: args.has("guides"), scale,
});

// ---------- tela de bloqueio simulada ----------
type Child = Record<string, unknown> | string | false | null | undefined;
const el = (type: string, style: Record<string, unknown>, ...children: Child[]) => {
  const kids = children.filter((c) => c !== false && c != null);
  return { type, props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids } };
};
const dataUri = `data:image/png;base64,${wallpaper.toString("base64")}`;
// o iOS amplia a imagem centralizada: recorta as bordas
const zW = Math.round(W * zoom);
const zH = Math.round(H * zoom);
const wall = {
  type: "img",
  props: { src: dataUri, width: zW, height: zH, style: { position: "absolute", left: -Math.round((zW - W) / 2), top: -Math.round((zH - H) / 2), width: zW, height: zH } },
};

const white = "#ffffff";
const dim = "rgba(255,255,255,0.65)";
const glass = "rgba(60,60,60,0.55)";
const time = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
const dateLine = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "short", day: "numeric" }).format(now).replace(".", "");
// posições medidas no print do iPhone 16 (tela 1179×2556)
const system = [
  el("div", { position: "absolute", left: 120, top: 62, fontSize: 40, fontWeight: 600, color: white }, "Operadora"),
  el("div", { position: "absolute", left: 400, top: 34, width: 379, height: 108, borderRadius: 54, background: "#000" }),
  // sinal (4 barras), wifi (arco simples) e bateria desenhados com formas (a fonte não tem esses glifos)
  ...[0, 1, 2, 3].map((i) => el("div", { position: "absolute", left: 845 + i * 18, top: 100 - (14 + i * 9), width: 12, height: 14 + i * 9, borderRadius: 3, background: white })),
  el("div", { position: "absolute", left: 950, top: 72, width: 50, height: 50, borderRadius: 25, border: "7px solid #fff", borderBottomColor: "transparent", borderLeftColor: "transparent", borderRightColor: "transparent" }),
  el("div", { position: "absolute", left: 1020, top: 66, width: 92, height: 44, borderRadius: 14, background: white, alignItems: "center", justifyContent: "center", color: "#000", fontSize: 32, fontWeight: 700 }, "60"),
  el("div", { position: "absolute", left: 0, top: 240, width: W, justifyContent: "center", fontSize: 50, fontWeight: 600, color: white }, `${dateLine}  ·  evento 00:00–00:30`),
  el("div", { position: "absolute", left: 0, top: 318, width: W, justifyContent: "center", fontSize: 330, fontWeight: 700, color: white, lineHeight: 1 }, time),
  // widgets
  el("div", { position: "absolute", left: 100, top: 2041, width: 8, height: 86, borderRadius: 4, background: white }),
  el("div", { position: "absolute", left: 124, top: 2036, flexDirection: "column", color: white }, el("div", { fontSize: 38, fontWeight: 600 }, "Evento"), el("div", { fontSize: 34, color: dim }, "00:00–00:30")),
  el("div", { position: "absolute", left: 639, top: 2036, flexDirection: "column", color: white }, el("div", { fontSize: 38, fontWeight: 600 }, "Widget"), el("div", { fontSize: 34, color: dim }, "texto de apoio")),
  // controles inferiores
  el("div", { position: "absolute", left: 138, top: 2230, width: 174, height: 174, borderRadius: 87, background: glass }),
  el("div", { position: "absolute", left: 867, top: 2230, width: 174, height: 174, borderRadius: 87, background: glass }),
  // "lua" do Não perturbe: círculo branco com outro escuro sobreposto
  el("div", { position: "absolute", left: 420, top: 2300, width: 38, height: 38, borderRadius: 19, background: white }),
  el("div", { position: "absolute", left: 432, top: 2296, width: 34, height: 34, borderRadius: 17, background: "#1a1a1a" }),
  el("div", { position: "absolute", left: 480, top: 2294, fontSize: 46, fontWeight: 600, color: white }, "Não perturbe"),
  el("div", { position: "absolute", left: 381, top: 2512, width: 420, height: 12, borderRadius: 6, background: white }),
];

const screen = el("div", { position: "relative", width: W, height: H, background: "#000", overflow: "hidden", fontFamily: "Inter" }, wall as never, ...(args.has("no-system") ? [] : system));
const svg = await satori(screen as never, { width: W, height: H, fonts: getFonts() });
const sim = new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } }).render().asPng();

mkdirSync("out", { recursive: true });
writeFileSync("out/simulator.png", sim);
writeFileSync("out/wallpaper.png", wallpaper);

// ---------- relatório ----------
// y da imagem → y da tela com o zoom centralizado
const toScreen = (frac: number) => 0.5 + (frac - 0.5) * zoom;
const cTop = toScreen(layout.contentBox.top / H);
const cBottom = toScreen(layout.contentBox.bottom / H);
const left = (0.5 + ((layout.contentBox.left / W) - 0.5) * zoom) * 100;
const CLOCK_BOTTOM = 0.25; // do print: fim do relógio
const WIDGETS_TOP = 0.79; // do print: início dos widgets
const used = layout.rowsShown;
console.log(`Fonte das tarefas: ${args.has("live") ? "Notion (ao vivo)" : "dados fictícios"} | ${selection.counts.total} tasks, ${used} visíveis${layout.rowsHidden ? `, +${layout.rowsHidden} ocultas` : ""}`);
if (life) console.log(`Vida: ${formatPercent(life.fraction)}% (${life.style})`);
else console.log(`Vida: sem gráfico (${lifeArg === "off" ? "--life=off" : lifeLoaded.reason})`);
if (brioNote) console.log(brioNote);
console.log(`Zoom do iOS: ${zoom} | imagem ${W * scale}×${H * scale}`);
console.log(`Conteúdo na tela: ${(cTop * 100).toFixed(1)}% → ${(cBottom * 100).toFixed(1)}% da altura | margem esquerda ${left.toFixed(1)}% da largura`);
if (left < 4) console.log("⚠ margem lateral pequena: o texto pode encostar na borda (aumente marginX).");
if (cTop < CLOCK_BOTTOM + 0.01) console.log(`⚠ o conteúdo começa antes do fim do relógio (${CLOCK_BOTTOM * 100}%): aumente safeTop.`);
if (cBottom > WIDGETS_TOP - 0.01) console.log(`⚠ o conteúdo passa do início dos widgets (${WIDGETS_TOP * 100}%): diminua safeBottom.`);
console.log("Arquivos: out/simulator.png, out/wallpaper.png");
