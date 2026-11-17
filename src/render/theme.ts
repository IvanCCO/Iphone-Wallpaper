import type { Priority } from "../domain/tasks.js";

export type ThemeName = "dark" | "light";

export interface Theme {
  bg: string;
  text: string;
  muted: string;
  border: string;
  danger: string;
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
    tag: {
      high: { bg: "#ffe2dd", fg: "#5d1715" },
      medium: { bg: "#fdecc8", fg: "#402c1b" },
      low: { bg: "#e3e2e0", fg: "#32302c" },
    },
  },
};
