/** Erro de aplicação com código estável e status HTTP. A mensagem NUNCA deve conter dados de tarefas. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badParams = (message: string) => new AppError("BAD_PARAMS", 400, message);
export const unauthorized = () =>
  new AppError("UNAUTHORIZED", 401, "Token ausente ou inválido.", {
    "WWW-Authenticate": 'Bearer realm="personal-api"',
  });
export const configError = (message: string) => new AppError("CONFIG_ERROR", 500, message);
