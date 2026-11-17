import type { LogFields } from "./lib/logger.js";

/** Tipos de contexto do Hono compartilhados pelas rotas. */
export type AppEnv = {
  Variables: {
    requestId: string;
    /** Campos extras para o log da requisição (nunca PII). */
    logFields: LogFields;
  };
};
