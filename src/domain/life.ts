import { dayKeyInTz, daysBetween } from "./tasks.js";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** true se `value` é uma data civil válida YYYY-MM-DD. */
export function isValidCivilDate(value: string): boolean {
  const m = value.match(DATE_ONLY);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Aniversário de `years` anos depois (29/02 cai em 01/03 em ano não bissexto). */
export function addYears(dateKey: string, years: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y + years, m - 1, d));
  return date.toISOString().slice(0, 10);
}

/** Fração do dia já decorrida no fuso `tz` (0 a <1). */
function dayFraction(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") * 3600 + get("minute") * 60 + get("second")) / 86400;
}

/**
 * Quanto da vida já passou, de 0 a 1: do nascimento até o aniversário de `lifespanYears` anos
 * (o dia exato da morte é desconhecido, então usamos esse aniversário como fim).
 * Tudo em dias civis no fuso `tz`, com a fração do dia atual.
 */
export function lifeProgress(birthDate: string, lifespanYears: number, now: Date, tz: string): number {
  const today = dayKeyInTz(now, tz);
  const end = addYears(birthDate, lifespanYears);
  const total = daysBetween(birthDate, end);
  const elapsed = daysBetween(birthDate, today) + dayFraction(now, tz);
  return Math.min(1, Math.max(0, elapsed / total));
}

/** "22.33" (duas casas, ponto decimal). */
export const formatPercent = (fraction: number): string => (fraction * 100).toFixed(2);
