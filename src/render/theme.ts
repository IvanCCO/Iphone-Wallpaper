import type { Priority } from "../domain/tasks.js";

export type ThemeName = "dark" | "light";

export interface Theme {
  bg: string;
  text: string;
  muted: string;
  border: string;
  danger: string;
  /** Gráfico de vida: parte preenchida (roxo escuro, análogo ao fundo frio) e o resto (neutro). */
  accent: string;
  track: string;
  tag: Record<Exclude<Priority, "none">, { bg: string; fg: string }>;
}

/** Paleta inspirada no Notion (modo escuro e claro). Fundo sólido garante contraste sob o relógio. */
export const THEMES: Record<ThemeName, Theme> = {
  dark: {
    bg: "#191919",
    text: "#ebebea",
    muted: "#9b9b9b",
    border: "#454545",
    danger: "#ff7369",
    accent: "#7e5bc4",
    track: "#353536",
    tag: {
      high: { bg: "#5c2b29", fg: "#ffb3ac" },
      medium: { bg: "#5a4620", fg: "#ffd78a" },
      low: { bg: "#373737", fg: "#c7c7c7" },
    },
  },
  light: {
    bg: "#ffffff",
    text: "#37352f",
    muted: "#787774",
    border: "#c7c5c0",
    danger: "#c4443a",
    accent: "#5e3fa3",
    track: "#e3e1e8",
    tag: {
      high: { bg: "#ffe2dd", fg: "#5d1715" },
      medium: { bg: "#fdecc8", fg: "#402c1b" },
      low: { bg: "#e3e2e0", fg: "#32302c" },
    },
  },
};
