import { createApp } from "./app.js";

/**
 * Entrada para a Vercel (zero-config Hono): o app é o `export default`.
 * Para rodar local, veja src/dev.ts.
 */
const app = createApp();
export default app;
