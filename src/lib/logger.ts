/**
 * Log JSON de uma linha por evento. Regras de privacidade:
 * - nunca registrar títulos de tarefas, tokens ou query string;
 * - apenas contagens, durações e códigos.
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export const consoleLogger: Logger = {
  info: (event, fields) => console.log(JSON.stringify({ level: "info", event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
};

export const silentLogger: Logger = { info() {}, error() {} };
