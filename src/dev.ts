import { serve } from "@hono/node-server";
import { createApp } from "./create-app.js";

/** Servidor local. Lê variáveis do ambiente (use `node --env-file=.env` ou `pnpm dev`). */
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: createApp().fetch, port, hostname: process.env.HOST ?? "127.0.0.1" }, (info) => {
  console.log(`personal-api em http://${info.address}:${info.port}`);
});
