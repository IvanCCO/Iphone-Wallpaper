import { describe, expect, it } from "vitest";
import { loadAuthConfig, loadImageDefaults, loadNotionConfig, parseFileConfig } from "../src/config.js";
import { tokenMatches } from "../src/lib/auth.js";
import { TtlCache } from "../src/lib/cache.js";

describe("tokenMatches", () => {
  it("aceita qualquer token da lista (rotação) e recusa o resto", () => {
    const tokens = ["a".repeat(30), "b".repeat(30)];
    expect(tokenMatches("b".repeat(30), tokens)).toBe(true);
    expect(tokenMatches("c".repeat(30), tokens)).toBe(false);
    expect(tokenMatches("", tokens)).toBe(false);
  });
});

describe("config", () => {
  it("falha fechado sem token ou com token curto", () => {
    expect(() => loadAuthConfig({})).toThrow(/API_TOKEN/);
    expect(() => loadAuthConfig({ API_TOKEN: "curto" })).toThrow(/24/);
    expect(loadAuthConfig({ API_TOKENS: `${"a".repeat(24)}, ${"b".repeat(24)}` }).tokens).toHaveLength(2);
  });

  it("erro do Notion lista só nomes de variáveis, nunca valores", () => {
    try {
      loadNotionConfig({ NOTION_TOKEN: "segredo-segredo" }, parseFileConfig({}));
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("NOTION_DATABASE_ID");
      expect((e as Error).message).not.toContain("segredo");
    }
  });

  it("rejeita chaves desconhecidas no JSON (typos)", () => {
    expect(() => parseFileConfig({ statuss: {} })).toThrow(/config\/notion\.json/);
  });

  it("normaliza o id do database e valida zona segura", () => {
    const c = loadNotionConfig({ NOTION_TOKEN: "x".repeat(12), NOTION_DATABASE_ID: "01234567-89ab-cdef-0123-456789abcdef" }, parseFileConfig({}));
    expect(c.databaseId).toBe("0123456789abcdef0123456789abcdef");
    expect(() => parseFileConfig({ image: { safeTop: 0.9 } })).toThrow(/image\.safeTop/);
    expect(loadImageDefaults(parseFileConfig({ image: { safeTop: 0.3 } })).safeTop).toBe(0.3);
  });
});

describe("TtlCache", () => {
  it("respeita TTL e faz single-flight; não cacheia falhas", async () => {
    let t = 0;
    const cache = new TtlCache<number>(() => t);
    let calls = 0;
    const load = async () => ++calls;
    const [a, b] = await Promise.all([cache.getOrLoad("k", 1000, load), cache.getOrLoad("k", 1000, load)]);
    expect([a.value, b.value, calls]).toEqual([1, 1, 1]);
    expect((await cache.getOrLoad("k", 1000, load)).hit).toBe("hit");
    t = 1001;
    expect((await cache.getOrLoad("k", 1000, load)).value).toBe(2);

    await expect(cache.getOrLoad("f", 1000, async () => Promise.reject(new Error("x")))).rejects.toThrow();
    expect((await cache.getOrLoad("f", 1000, async () => 9)).value).toBe(9);
  });
});

describe("config/notion.json real", () => {
  it("é válido", async () => {
    const raw = (await import("../config/notion.json")).default;
    expect(() => parseFileConfig(raw)).not.toThrow();
  });
});
