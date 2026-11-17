import { z } from "zod";
import type { ImageDefaults } from "../../config.js";
import type { Priority, View } from "../../domain/tasks.js";
import { badParams } from "../../errors.js";
import type { ThemeName } from "../../render/theme.js";

export interface TaskImageParams {
  width: number;
  height: number;
  view: View;
  priorities: Priority[];
  limit: number;
  theme: ThemeName;
  tz: string;
  safeTop: number;
  safeBottom: number;
  marginX: number;
  scale: number;
  /** false desliga o gráfico de vida; lifeStyle sobrescreve o estilo do config. */
  life: boolean;
  lifeStyle?: "pie" | "bar";
  guides: boolean;
}

/** Limite de pixels da imagem final (width × height × scale²). */
const MAX_PIXELS = 20_000_000;
const PRIORITIES = ["high", "medium", "low", "none"] as const;

const isValidTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Parâmetros desconhecidos (inclusive `key`) são ignorados. Qualquer valor inválido => 400. */
export function parseTaskImageParams(query: Record<string, string>, d: ImageDefaults): TaskImageParams {
  const schema = z.object({
    width: z.coerce.number().int().min(320).max(1500).default(1179),
    height: z.coerce.number().int().min(640).max(3200).default(2556),
    view: z.enum(["today", "pending", "all"]).default("today"),
    priority: z
      .string()
      .default("")
      .transform((s) => s.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean))
      .pipe(z.array(z.enum(PRIORITIES))),
    limit: z.coerce.number().int().min(1).max(12).default(8),
    theme: z.enum(["dark", "light"]).default("dark"),
    tz: z.string().max(64).default(d.tz).refine(isValidTz, "fuso horário inválido"),
    safeTop: z.coerce.number().min(0.1).max(0.6).default(d.safeTop),
    safeBottom: z.coerce.number().min(0.5).max(0.95).default(d.safeBottom),
    marginX: z.coerce.number().min(0.03).max(0.3).default(d.marginX),
    scale: z.coerce.number().min(1).max(3).default(d.scale),
    life: z.enum(["0", "1"]).default("1"),
    lifeStyle: z.enum(["pie", "bar"]).optional(),
    guides: z.enum(["0", "1"]).default("0"),
  });

  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
    throw badParams(`Parâmetros inválidos: ${fields.join(", ")}`);
  }
  const p = parsed.data;
  if (p.width * p.height * p.scale * p.scale > MAX_PIXELS) throw badParams("Parâmetros inválidos: width×height×scale² excede 20 megapixels");
  if (p.safeBottom - p.safeTop < 0.2) throw badParams("Parâmetros inválidos: safeTop/safeBottom");

  return {
    width: p.width,
    height: p.height,
    view: p.view,
    priorities: p.priority,
    limit: p.limit,
    theme: p.theme,
    tz: p.tz,
    safeTop: p.safeTop,
    safeBottom: p.safeBottom,
    marginX: p.marginX,
    scale: p.scale,
    life: p.life === "1",
    lifeStyle: p.lifeStyle,
    guides: p.guides === "1",
  };
}
