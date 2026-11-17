import { describe, expect, it } from "vitest";
import { loadLifeConfig, parseFileConfig } from "../src/config.js";
import { addYears, formatPercent, isValidCivilDate, lifeProgress } from "../src/domain/life.js";

const TZ = "America/Sao_Paulo";
// Datas FICTÍCIAS: nunca use a data de nascimento real em testes ou no repositório.
const BIRTH = "2000-03-09";

describe("lifeProgress", () => {
  it("0% no nascimento (início do dia) e 100% no aniversário final", () => {
    expect(lifeProgress(BIRTH, 84, new Date("2000-03-09T03:00:00Z"), TZ)).toBeCloseTo(0, 6); // 00:00 em SP
    expect(lifeProgress(BIRTH, 84, new Date("2084-03-09T15:00:00Z"), TZ)).toBe(1);
  });

  it("limita entre 0 e 1 (antes de nascer / depois do fim)", () => {
    expect(lifeProgress(BIRTH, 84, new Date("1990-01-01T12:00:00Z"), TZ)).toBe(0);
    expect(lifeProgress(BIRTH, 84, new Date("2200-01-01T12:00:00Z"), TZ)).toBe(1);
  });

  it("aos 42 anos (meio da vida) é ~50%", () => {
    const f = lifeProgress(BIRTH, 84, new Date("2042-03-09T15:00:00Z"), TZ);
    expect(f).toBeGreaterThan(0.4995);
    expect(f).toBeLessThan(0.5006);
  });

  it("cresce ao longo do dia (fração do dia no fuso)", () => {
    const manha = lifeProgress(BIRTH, 84, new Date("2026-11-16T10:00:00Z"), TZ);
    const noite = lifeProgress(BIRTH, 84, new Date("2026-11-17T01:00:00Z"), TZ); // 22:00 de 16/11 em SP
    expect(noite).toBeGreaterThan(manha);
  });

  it("formata com duas casas e ponto decimal", () => {
    expect(formatPercent(0.2233)).toBe("22.33");
    expect(formatPercent(0)).toBe("0.00");
    expect(formatPercent(1)).toBe("100.00");
  });

  it("addYears e validação de data", () => {
    expect(addYears("2000-03-09", 84)).toBe("2084-03-09");
    expect(addYears("2000-02-29", 1)).toBe("2001-03-01");
    expect(isValidCivilDate("2000-03-09")).toBe(true);
    expect(isValidCivilDate("2000-02-30")).toBe(false);
    expect(isValidCivilDate("09/03/2000")).toBe(false);
  });
});

describe("loadLifeConfig", () => {
  it("ligado com birthDate válida no JSON", () => {
    const file = parseFileConfig({ lifeProgress: { birthDate: BIRTH } });
    expect(loadLifeConfig(file).config).toEqual({ birthDate: BIRTH, lifespanYears: 84, style: "bar" });
  });

  it("desligado sem data ou com enabled=false (nunca derruba o wallpaper)", () => {
    expect(loadLifeConfig(parseFileConfig({}))).toEqual({ reason: "no_birth_date" });
    expect(loadLifeConfig(parseFileConfig({ lifeProgress: { birthDate: BIRTH, enabled: false } }))).toEqual({ reason: "disabled" });
  });

  it("data inválida no JSON é erro de configuração claro", () => {
    expect(() => parseFileConfig({ lifeProgress: { birthDate: "ontem" } })).toThrow(/lifeProgress\.birthDate/);
    expect(() => parseFileConfig({ lifeProgress: { birthDate: "2000-02-30" } })).toThrow(/birthDate/);
  });
});
