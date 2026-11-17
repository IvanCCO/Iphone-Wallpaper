import { BUCKET_ORDER, type Bucket, type Priority, type Selection, type TaskItem } from "../domain/tasks.js";
import { formatPercent } from "../domain/life.js";
import { THEMES, type Theme, type ThemeName } from "./theme.js";

/** Largura de referência (iPhone 14/15/16 de 6,1"). Todas as medidas escalam com width/1179. */
export const REF_WIDTH = 1179;

/** Nó mínimo compatível com Satori (sem JSX). */
export interface Node {
  type: string;
  props: { style?: Record<string, unknown>; children?: unknown; [k: string]: unknown };
}

type Child = Node | string | false | null | undefined;

function h(type: string, style: Record<string, unknown>, ...children: Child[]): Node {
  const kids = children.filter((c): c is Node | string => c !== false && c != null);
  return { type, props: { style, children: kids.length === 1 ? kids[0] : kids } };
}

/** `div` flex por padrão (Satori exige display:flex quando há vários filhos). */
const div = (style: Record<string, unknown>, ...children: Child[]) =>
  h("div", { display: "flex", ...style }, ...children);

export interface LayoutInput {
  selection: Selection;
  width: number;
  height: number;
  theme: ThemeName;
  tz: string;
  now: Date;
  /** Quando os dados foram lidos do Notion (carimbo "atualizado"). */
  fetchedAt: Date;
  limit: number;
  /** Faixa vertical (fração da altura) onde o conteúdo é desenhado. */
  safeTop: number;
  safeBottom: number;
  /** Margem lateral (fração da largura) de cada lado. */
  marginX: number;
  /** Progresso de vida (0 a 1) e estilo; omitido = sem gráfico. */
  life?: { fraction: number; style: "pie" | "bar" };
  /** Seção compacta de outra fonte (ex.: "Brio"): divisor + rótulo + linhas de uma linha cada. */
  brio?: { label: string; items: { title: string; status?: string }[]; hidden: number };
  guides: boolean;
}

export interface LayoutResult {
  root: Node;
  /** Caixa (px) onde todo o conteúdo é desenhado. Usada pelos testes de zona segura. */
  contentBox: { top: number; bottom: number; left: number; right: number };
  rowsShown: number;
  rowsHidden: number;
}

const SECTION_LABEL: Record<Bucket, string> = {
  overdue: "Atrasadas",
  today: "Hoje",
  upcoming: "Próximas",
  undated: "Sem data",
  done: "Concluídas hoje",
};


/** "Atualizado em 16/11 22:10 · 4 tasks" */
function subtitle(fetchedAt: Date, tz: string, count: number): string {
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(fetchedAt);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(fetchedAt);
  return `Atualizado em ${day} ${time} · ${count} task${count === 1 ? "" : "s"}`;
}

function dueLabel(item: TaskItem, tz: string): { text: string; danger: boolean } | undefined {
  const d = item.daysDiff;
  if (d === undefined) return undefined;
  if (item.bucket === "overdue") {
    const when = d === -1 ? "ontem" : `há ${-d} dias`;
    return { text: item.timeLabel ? `${when}, ${item.timeLabel}` : when, danger: true };
  }
  if (item.bucket === "today") return item.timeLabel ? { text: item.timeLabel, danger: false } : undefined;
  if (item.bucket === "upcoming") {
    const day = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(
      new Date(`${item.dueKey}T12:00:00Z`),
    );
    return { text: d === 1 ? "amanhã" : day.replace(".", ""), danger: false };
  }
  return undefined;
}


// ---------- gráfico de vida ----------

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/** Rosca (pie/donut): trilho neutro + arco roxo a partir do topo, no sentido horário. */
function donutSvg(size: number, thickness: number, fraction: number, theme: Theme): string {
  const r = (size - thickness) / 2;
  const c = size / 2;
  const len = 2 * Math.PI * r;
  const arc = Math.max(0, Math.min(1, fraction)) * len;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${theme.track}" stroke-width="${thickness}"/>` +
    (arc > 0 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${theme.accent}" stroke-width="${thickness}" stroke-linecap="round" stroke-dasharray="${arc} ${len}" transform="rotate(-90 ${c} ${c})"/>` : "") +
    `</svg>`;
}

/** Caveira desenhada como vetor (emoji não depende de fonte/rede no servidor). */
function skullSvg(size: number, color: string, hole: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
    `<path fill="${color}" d="M12 2C7.6 2 4 5.4 4 9.6c0 2.6 1.3 4.6 3 5.9V19c0 .6.4 1 1 1h1.5v-2h1v2h3v-2h1v2H16c.6 0 1-.4 1-1v-3.5c1.7-1.3 3-3.3 3-5.9C20 5.4 16.4 2 12 2z"/>` +
    `<circle cx="8.8" cy="10.2" r="2.1" fill="${hole}"/><circle cx="15.2" cy="10.2" r="2.1" fill="${hole}"/>` +
    `<path fill="${hole}" d="M12 12.6l1.1 2.2h-2.2z"/></svg>`;
}

const img = (src: string, w: number, h: number, style: Record<string, unknown> = {}): Node => ({
  type: "img",
  props: { src, width: w, height: h, style: { width: w, height: h, ...style } },
});

/** Estimativa conservadora de linhas (Inter ≈ 0.58 em de largura média), limitada a 2. */
export function estimateLines(text: string, fontPx: number, widthPx: number): number {
  const perLine = Math.max(1, Math.floor(widthPx / (fontPx * 0.58)));
  return Math.min(2, Math.max(1, Math.ceil(text.length / perLine)));
}

export function buildLayout(input: LayoutInput): LayoutResult {
  const { width: W, height: H } = input;
  const s = W / REF_WIDTH;
  const px = (n: number) => Math.round(n * s);
  const theme: Theme = THEMES[input.theme];

  const left = Math.round(W * input.marginX);
  const boxW = W - left * 2;
  const top = Math.round(H * input.safeTop);
  const bottom = Math.round(H * input.safeBottom);
  const boxH = bottom - top;

  // tipografia
  const F = { h1: px(56), sub: px(28), section: px(28), title: px(38), meta: px(25) };
  const titleWidth = boxW;
  const rowPad = px(14);
  const titleLine = Math.round(F.title * 1.25);
  const metaRow = px(48);

  const lifeStyle = input.life?.style;
  const pieSize = px(184);
  const barW = px(330);
  const lifeH = !input.life ? 0 : lifeStyle === "pie" ? pieSize : px(84);
  const textH = Math.round(F.h1 * 1.2) + Math.round(F.sub * 1.3);
  const headerH = Math.max(textH, lifeH) + px(30);
  const fullSectionH = Math.round(F.section * 1.3) + px(20);

  // seção "Brio": compacta, reservada ANTES das tarefas principais para nunca ser empurrada para fora
  const brio = input.brio && input.brio.items.length > 0 ? input.brio : undefined;
  const brioTitleF = px(28);
  const brioStatusF = px(21);
  const brioRowH = Math.round(brioTitleF * 1.25) + px(18);
  const brioStatusW = px(170);
  const brioLabelH = Math.round(px(26) * 1.3);
  const brioH = brio ? px(34) + brioLabelH + px(14) + brio.items.length * brioRowH : 0;
  const moreH = Math.round(F.meta * 1.4) + px(10);

  const rowMeta = (it: TaskItem) => {
    const due = dueLabel(it, input.tz);
    const hasPriority = !!it.tag;
    return { due, hasPriority, hasMeta: hasPriority || !!due };
  };
  const rowHeight = (it: TaskItem) => {
    const lines = estimateLines(it.title, F.title, titleWidth);
    return rowPad * 2 + lines * titleLine + (rowMeta(it).hasMeta ? metaRow : 0);
  };

  // ---- grupos de exibição ----
  // Só tarefas sem data e com status: agrupa por status (ordem de statuses.active). Senão, por bucket.
  interface Group {
    label: string;
    danger: boolean;
    items: TaskItem[];
  }
  const sec = input.selection.sections;
  const groups: Group[] = [];
  const statusMode = input.selection.counts.total === sec.undated.length && sec.undated.length > 0 && sec.undated.every((i) => i.status);
  if (statusMode) {
    for (const it of sec.undated) {
      const last = groups[groups.length - 1];
      if (last && last.label === it.status) last.items.push(it);
      else groups.push({ label: it.status!, danger: false, items: [it] });
    }
  } else {
    for (const bucket of BUCKET_ORDER) {
      if (sec[bucket].length > 0) groups.push({ label: SECTION_LABEL[bucket], danger: bucket === "overdue", items: sec[bucket] });
    }
  }

  // Com um único grupo por status (ex.: só "À Fazer") o cabeçalho de seção é redundante.
  const showHeaders = !(statusMode && groups.length === 1);
  const sectionH = showHeaders ? fullSectionH : 0;

  // ---- seleciona o que cabe ----
  let budget = boxH - headerH - brioH;
  const picked: { group: Group; items: TaskItem[] }[] = [];
  let shown = 0;
  let total = 0;
  for (const g of groups) total += g.items.length;

  outer: for (const grp of groups) {
    const items = grp.items;
    if (budget < sectionH + rowHeight(items[0]!) + moreH) break;
    budget -= sectionH;
    const group: TaskItem[] = [];
    for (const it of items) {
      const rh = rowHeight(it);
      // reserva espaço para a linha "+N mais" se ainda sobrar tarefa depois desta
      const remainingAfter = total - shown - 1;
      const reserve = remainingAfter > 0 ? moreH : 0;
      if (shown >= input.limit || budget < rh + reserve) {
        if (group.length > 0) picked.push({ group: grp, items: group });
        break outer;
      }
      budget -= rh;
      shown++;
      group.push(it);
    }
    picked.push({ group: grp, items: group });
  }
  const hidden = total - shown;

  // ---- constrói os nós ----
  const titleBlock = div(
    { flexDirection: "column" },
    div({ fontSize: F.h1, fontWeight: 700, color: theme.text, lineHeight: 1.2 }, "Tasks"),
    div({ fontSize: F.sub, fontWeight: 400, color: theme.muted, lineHeight: 1.3 }, subtitle(input.fetchedAt, input.tz, input.selection.counts.total)),
  );

  let lifeNode: Node | undefined;
  if (input.life) {
    const pct = `${formatPercent(input.life.fraction)}%`;
    if (input.life.style === "pie") {
      const thickness = Math.round(pieSize * 0.115);
      lifeNode = div(
        { position: "relative", width: pieSize, height: pieSize, flexShrink: 0 },
        img(svgUri(donutSvg(pieSize, thickness, input.life.fraction, theme)), pieSize, pieSize, { position: "absolute", left: 0, top: 0 }),
        div(
          { position: "absolute", left: 0, top: 0, width: pieSize, height: pieSize, alignItems: "center", justifyContent: "center", fontSize: px(29), fontWeight: 700, color: theme.text },
          pct,
        ),
      );
    } else {
      const barH = px(16);
      const fillW = Math.round(barW * Math.max(0, Math.min(1, input.life.fraction)));
      const skull = px(40);
      lifeNode = div(
        { flexDirection: "column", width: barW, flexShrink: 0 },
        div(
          { alignItems: "center", justifyContent: "space-between", marginBottom: px(14) },
          div({ fontSize: px(36), fontWeight: 700, color: theme.text }, pct),
          img(svgUri(skullSvg(skull, theme.muted, theme.bg)), skull, skull),
        ),
        div(
          { width: barW, height: barH, borderRadius: barH / 2, background: theme.track },
          fillW > 0 && div({ width: Math.max(fillW, barH), height: barH, borderRadius: barH / 2, background: theme.accent }),
        ),
      );
    }
  }

  const header = div(
    { alignItems: "center", justifyContent: "space-between", width: boxW, height: headerH, paddingBottom: px(30) },
    titleBlock,
    lifeNode,
  );

  const renderRow = (it: TaskItem): Node => {
    const { due, hasPriority } = rowMeta(it);
    const meta: Child[] = [];
    if (hasPriority) {
      // cor pela prioridade mapeada; tags sem prioridade (ex.: "Normal", "Brio") ficam neutras
      const t = theme.tag[it.priority === "none" ? "low" : it.priority];
      meta.push(
        div(
          { background: t.bg, color: t.fg, fontSize: F.meta, fontWeight: 600, padding: `${px(4)}px ${px(16)}px`, borderRadius: px(10), marginRight: px(16) },
          it.tag,
        ),
      );
    }
    if (due) meta.push(div({ fontSize: F.meta, color: due.danger ? theme.danger : theme.muted, fontWeight: 400 }, due.text));

    return div(
      { alignItems: "flex-start", paddingTop: rowPad, paddingBottom: rowPad, borderTop: `${Math.max(1, px(2))}px solid ${theme.border}` },
      div(
        { flexDirection: "column", width: titleWidth },
        div(
          {
            fontSize: F.title,
            lineHeight: 1.25,
            fontWeight: 400,
            color: it.done ? theme.muted : theme.text,
            textDecoration: it.done ? "line-through" : "none",
            // altura natural (a estimativa só serve para decidir quantas linhas cabem); no máximo 2 linhas
            lineClamp: 2,
          },
          it.title,
        ),
        meta.length > 0 && div({ alignItems: "center", marginTop: px(10), height: metaRow - px(10) }, ...meta),
      ),
    );
  };

  const body: Child[] = [];
  if (shown === 0) {
    body.push(
      div(
        { flexDirection: "column", paddingTop: px(40) },
        div({ fontSize: px(48), fontWeight: 600, color: theme.text }, "Tudo em dia"),
        div({ fontSize: F.sub, color: theme.muted, marginTop: px(12) }, "Nenhuma tarefa pendente."),
      ),
    );
  }
  for (const group of picked) {
    if (showHeaders) body.push(
      div(
        { height: sectionH, alignItems: "flex-end", paddingBottom: px(10), fontSize: F.section, fontWeight: 600, color: group.group.danger ? theme.danger : theme.muted },
        `${group.group.label}  ·  ${group.group.items.length}`,
      ),
    );
    body.push(...group.items.map(renderRow));
  }
  if (hidden > 0) {
    body.push(div({ height: moreH, alignItems: "center", fontSize: F.meta, color: theme.muted }, `+${hidden} mais`));
  }

  const hasStatus = !!brio?.items.some((i) => i.status);
  const brioNode = brio
    ? div(
        { flexDirection: "column", width: boxW, marginTop: px(34) },
        div(
          { alignItems: "center", height: brioLabelH, marginBottom: px(14) },
          div({ fontSize: px(26), fontWeight: 600, color: theme.muted, letterSpacing: px(1) }, brio.hidden > 0 ? `${brio.label}  ·  +${brio.hidden}` : brio.label),
          div({ flex: 1, height: Math.max(1, px(2)), background: theme.border, marginLeft: px(18) }),
        ),
        ...brio.items.map((it) =>
          div(
            { alignItems: "center", justifyContent: "space-between", height: brioRowH, width: boxW },
            div({ width: hasStatus ? boxW - brioStatusW - px(16) : boxW, fontSize: brioTitleF, color: theme.text, lineClamp: 1 }, it.title),
            hasStatus && div({ width: brioStatusW, justifyContent: "flex-end", fontSize: brioStatusF, color: theme.muted, lineClamp: 1 }, it.status ?? ""),
          ),
        ),
      )
    : undefined;

  const content = div(
    { position: "absolute", left, top, width: boxW, height: boxH, flexDirection: "column", overflow: "hidden" },
    header,
    div({ flexDirection: "column", width: boxW }, ...body),
    brioNode,
  );

  const guides = input.guides ? buildGuides(W, H, input, theme) : null;
  const root = div({ position: "relative", width: W, height: H, background: theme.bg, fontFamily: "Inter" }, content, guides);

  return { root, contentBox: { top, bottom, left, right: left + boxW }, rowsShown: shown, rowsHidden: hidden };
}

/** Sobreposição de calibração: mostra as zonas ocupadas pelo sistema na tela de bloqueio. */
function buildGuides(W: number, H: number, input: LayoutInput, theme: Theme): Node {
  const zone = (from: number, to: number, color: string, label: string) =>
    div(
      {
        position: "absolute",
        left: 0,
        top: Math.round(H * from),
        width: W,
        height: Math.round(H * (to - from)),
        background: color,
        fontSize: Math.round(W * 0.03),
        color: theme.text,
        padding: 12,
      },
      label,
    );
  return div(
    { position: "absolute", left: 0, top: 0, width: W, height: H },
    zone(0, 0.08, "rgba(255,0,0,0.25)", "status bar / ilha"),
    zone(0.08, input.safeTop, "rgba(255,160,0,0.25)", "data + relogio"),
    zone(input.safeBottom, 1, "rgba(255,0,0,0.25)", "widgets / controles"),
  );
}
