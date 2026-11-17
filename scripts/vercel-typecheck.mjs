// Reproduz o typecheck do @vercel/node (caminho ts-node com TypeScript 5.x):
//  - LanguageService com host SEM `realpath`. Com o node_modules em symlinks do pnpm, isso faz o TS não
//    achar dependências transitivas (ex.: `undici-types` usado por @types/node) e o `Response` global fica vazio.
//  - tsconfig lido do projeto, com files/include zerados e as sobrescritas do ts-node.
// Se esta checagem falhar, o build da Vercel falha (NODE_TYPESCRIPT_ERROR). Uso: node scripts/vercel-typecheck.mjs
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

const cwd = process.cwd();
const configFile = ts.findConfigFile(cwd, ts.sys.fileExists);
if (!configFile) throw new Error("tsconfig.json não encontrado");

const raw = ts.readConfigFile(configFile, ts.sys.readFile).config;
raw.files = [];
raw.include = [];
raw.compilerOptions = {
  ...raw.compilerOptions,
  sourceMap: true,
  inlineSourceMap: false,
  inlineSources: true,
  declaration: false,
  noEmit: false,
  outDir: "$$ts-node$$",
};
for (const k of ["out", "outFile", "composite", "declarationDir", "declarationMap", "emitDeclarationOnly", "tsBuildInfoFile", "incremental"]) {
  delete raw.compilerOptions[k];
}
const parsed = ts.parseJsonConfigFileContent(raw, ts.sys, dirname(configFile), undefined, configFile);

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p.replaceAll("\\", "/")] : [];
  });
const files = walk(join(cwd, "src"));

const host = {
  getScriptFileNames: () => files,
  getScriptVersion: () => "1",
  getScriptSnapshot: (f) => {
    const text = ts.sys.readFile(f);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  },
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  getDirectories: ts.sys.getDirectories,
  fileExists: ts.sys.fileExists,
  directoryExists: ts.sys.directoryExists,
  // sem `realpath` de propósito (igual ao @vercel/node)
  getNewLine: () => ts.sys.newLine,
  useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  getCurrentDirectory: () => cwd,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, cwd));

const IGNORE = new Set([6059, 18002, 18003]);
const diagnostics = files
  .flatMap((f) => [...service.getSemanticDiagnostics(f), ...service.getSyntacticDiagnostics(f)])
  .filter((d) => !IGNORE.has(d.code));

if (diagnostics.length > 0) {
  const fmt = {
    getNewLine: () => "\n",
    getCurrentDirectory: () => cwd,
    getCanonicalFileName: (p) => p,
  };
  console.error(ts.formatDiagnostics(diagnostics.slice(0, 12), fmt));
  if (diagnostics.length > 12) console.error(`... e mais ${diagnostics.length - 12} erro(s)`);
  process.exit(1);
}
console.log(`${files.length} arquivos sem erros`);
