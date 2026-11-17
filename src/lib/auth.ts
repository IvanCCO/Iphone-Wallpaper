import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AuthConfig } from "../config.js";
import { unauthorized } from "../errors.js";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Comparação em tempo constante (hash de tamanho fixo evita vazar o comprimento). */
export function tokenMatches(candidate: string, tokens: string[]): boolean {
  const c = digest(candidate);
  let ok = false;
  for (const t of tokens) {
    // não faz curto-circuito: percorre todos
    if (timingSafeEqual(c, digest(t))) ok = true;
  }
  return ok;
}

/**
 * Autentica por `Authorization: Bearer <token>` (preferido) ou `?key=<token>`
 * (compatível com Atalhos sem cabeçalhos; aparece em logs de URL, trate como segredo).
 * Falha fechado: sem token configurado => 500.
 */
export function requireToken(getAuth: () => AuthConfig): MiddlewareHandler {
  return async (c, next) => {
    const { tokens } = getAuth();
    const header = c.req.header("authorization");
    const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const candidate = bearer ?? c.req.query("key");
    if (!candidate || !tokenMatches(candidate, tokens)) throw unauthorized();
    await next();
  };
}
