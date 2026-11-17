// Validação de pré-push: reproduz o que costuma quebrar o deploy na Vercel.
// Uso: pnpm verify   (o hook .githooks/pre-push chama este script)
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const results = [];
let failed = false;

async function step(name, fn) {
  const t = performance.now();
  process.stdout.write(`• ${name} ... `);
  try {
    const note = await fn();
    console.log(`ok${note ? ` (${note})` : ""} [${Math.round(performance.now() - t)}ms]`);
    results.push([name, true]);
  } catch (e) {
    failed = true;
    console.log("FALHOU");
    console.log(String(e?.message ?? e).split("\n").map((l) => `    ${l}`).join("\n"));
    results.push([name, false]);
  }
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}\n${(r.stdout ?? "") + (r.stderr ?? "")}`.trim().slice(-2500));
  return r.stdout;
};

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

await step("versões fixadas (engines.node e packageManager)", () => {
  const node = pkg.engines?.node ?? "";
  if (!/^\d+(\.x|\.\d+\.\d+)?$/.test(node))
    throw new Error(`engines.node="${node}" sobe de versão sozinho na Vercel. Use uma major fixa, ex.: "22.x".`);
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager ?? ""))
    throw new Error('Defina "packageManager": "pnpm@x.y.z" no package.json.');
  const major = Number(process.versions.node.split(".")[0]);
  if (String(major) !== node.split(".")[0]) throw new Error(`Node local é ${process.versions.node}, projeto pede ${node}.`);
  return `node ${node}, ${pkg.packageManager}`;
});

await step("pnpm-lock.yaml em sincronia com package.json", () => {
  run("pnpm", ["install", "--frozen-lockfile", "--lockfile-only"]);
});

await step("sem segredos nos arquivos versionados", () => {
  const tracked = run("git", ["ls-files"]).split("\n").filter(Boolean);
  const envFiles = tracked.filter((f) => /(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith(".example"));
  if (envFiles.length) throw new Error(`Arquivo(s) .env versionado(s): ${envFiles.join(", ")}`);

  const secrets = [];
  if (existsSync(".env")) {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^(API_TOKENS?|NOTION_TOKEN)=(.{8,})$/);
      if (m) secrets.push(m[2].replace(/^["']|["']$/g, ""));
    }
  }
  const pattern = /\b(ntn_|secret_)[A-Za-z0-9]{20,}\b/;
  const hits = [];
  for (const f of tracked) {
    if (f.endsWith("pnpm-lock.yaml") || f.endsWith(".generated.ts")) continue;
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (pattern.test(text) || secrets.some((s) => text.includes(s))) hits.push(f);
  }
  if (hits.length) throw new Error(`Possível segredo em: ${hits.join(", ")}`);
  return `${tracked.length} arquivos`;
});

await step("typecheck (tsc)", () => {
  run("pnpm", ["-s", "typecheck"]);
});

await step("typecheck estilo Vercel (tsconfig temporário fora do projeto)", () => {
  // @vercel/node gera um tsconfig em /tmp que estende o do projeto e lista só os arquivos de entrada.
  // Isso quebra `types`/typeRoots relativos (ex.: não achar @types/node). Reproduzimos o mesmo cenário.
  const dir = mkdtempSync(join(tmpdir(), "vercel-typescript-"));
  try {
    const config = {
      extends: join(process.cwd(), "tsconfig.json"),
      compilerOptions: { noEmit: true, incremental: false, composite: false, rootDir: process.cwd() },
      files: [join(process.cwd(), "src", "index.ts")],
      include: [],
      exclude: [],
    };
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(config));
    run("pnpm", ["exec", "tsc", "--project", join(dir, "tsconfig.json")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await step("testes (vitest)", () => {
  const out = run("pnpm", ["-s", "test"]);
  return out.match(/Tests\s+([^\n]+)/)?.[1]?.trim();
});

await step("bundle como na Vercel + /health", async () => {
  const dir = join("out", ".verify"); // dentro do projeto (ignorado pelo git) para resolver node_modules
  mkdirSync(dir, { recursive: true });
  try {
    const outfile = join(process.cwd(), dir, "index.mjs");
    // pacotes ficam externos (como em node_modules); valida imports .js→.ts, JSON e a entrada `export default app`
    await build({ entryPoints: ["src/index.ts"], bundle: true, platform: "node", format: "esm", packages: "external", outfile, logLevel: "silent" });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.default?.fetch !== "function") throw new Error("src/index.ts deve exportar `default` o app Hono.");
    const res = await mod.default.request("/health");
    if (res.status !== 200) throw new Error(`/health respondeu ${res.status}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(failed ? "\n✖ Validação falhou: push bloqueado. (Emergência: SKIP_VERIFY=1 git push)" : "\n✔ Tudo certo.");
process.exit(failed ? 1 : 0);
