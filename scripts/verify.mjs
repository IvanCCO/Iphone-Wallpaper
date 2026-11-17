// Validação de pré-push: reproduz o que costuma quebrar o deploy na Vercel.
// Uso: pnpm verify   (o hook .githooks/pre-push chama este script)
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

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

await step("typecheck estilo Vercel (language service sem realpath, como o @vercel/node)", () => {
  run("node", ["scripts/vercel-typecheck.mjs"]);
});

await step("testes (vitest)", () => {
  const out = run("pnpm", ["-s", "test"]);
  return out.match(/Tests\s+([^\n]+)/)?.[1]?.trim();
});

// Regra copiada do @vercel/hono (dist/index.js): primeiro candidato que importa "hono".
const HONO_CANDIDATES = ["app", "index", "server", "src/app", "src/index", "src/server"];
const HONO_EXTENSIONS = ["js", "cjs", "mjs", "ts", "cts", "mts"];
const HONO_IMPORT = /(?:from|require|import)\s*(?:\(\s*)?["']hono["']\s*(?:\))?/g;
let vercelEntry;

await step("entrada da Vercel (Hono) tem export default", () => {
  const found = HONO_CANDIDATES.flatMap((f) => HONO_EXTENSIONS.map((e) => `${f}.${e}`)).filter((f) => existsSync(f));
  const matching = found.filter((f) => readFileSync(f, "utf8").match(HONO_IMPORT) !== null);
  vercelEntry = matching[0];
  if (!vercelEntry)
    throw new Error(`Nenhum arquivo de entrada importa "hono". Candidatos existentes: ${found.join(", ") || "nenhum"}.`);
  if (!/export\s+default\b/.test(readFileSync(vercelEntry, "utf8")))
    throw new Error(
      `A Vercel usará "${vercelEntry}" como entrada, mas ele não tem \`export default\` ` +
        `(a função falharia com "Invalid export found in module"). Mova a fábrica para um arquivo fora de ` +
        `${HONO_CANDIDATES.join(", ")} e deixe a entrada exportar o app.`,
    );
  return vercelEntry;
});

await step("runtime estilo Vercel (compila arquivo a arquivo e carrega no Node ESM)", () => {
  // A Vercel não empacota: compila cada .ts e o Node carrega como ESM. Pega o que tsx/esbuild perdoam
  // (ex.: import de JSON sem `with { type: "json" }`, extensões, dependência de módulo faltando).
  const dir = join("out", ".vruntime");
  rmSync(dir, { recursive: true, force: true });
  try {
    run("pnpm", ["exec", "tsc", "-p", "tsconfig.json", "--noEmit", "false", "--outDir", dir, "--rootDir", ".", "--incremental", "false", "--declaration", "false"]);
    const probe = `
      const m = await import(${JSON.stringify("./" + join(dir, (vercelEntry ?? "src/index.ts").replace(/\.[cm]?ts$/, ".js")))});
      if (typeof m.default?.fetch !== "function") throw new Error("a entrada deve exportar default o app Hono.");
      const r = await m.default.request("/health");
      if (r.status !== 200) throw new Error("/health respondeu " + r.status);
      const { renderTasksPng } = await import(${JSON.stringify("./" + join(dir, "src", "render", "png.js"))});
      const { selectTasks } = await import(${JSON.stringify("./" + join(dir, "src", "domain", "tasks.js"))});
      const now = new Date();
      const selection = selectTasks([{ id: "1", title: "Teste", done: false, priority: "none" }], { view: "pending", now, tz: "UTC" });
      const { png } = await renderTasksPng({ selection, width: 390, height: 844, theme: "dark", tz: "UTC", now, fetchedAt: now, limit: 8, safeTop: 0.30, safeBottom: 0.735, marginX: 0.125, guides: false });
      if (png.length < 500) throw new Error("PNG vazio");
    `;
    run("node", ["--input-type=module", "-e", probe]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(failed ? "\n✖ Validação falhou: push bloqueado. (Emergência: SKIP_VERIFY=1 git push)" : "\n✔ Tudo certo.");
process.exit(failed ? 1 : 0);
