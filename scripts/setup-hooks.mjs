// Aponta o git para .githooks (hooks versionados). Roda no `pnpm install` (prepare).
// Nunca falha: na Vercel/CI não há .git ou o git pode não existir.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

try {
  if (existsSync(".git")) {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
    console.log("git hooks ativados (.githooks/pre-push)");
  }
} catch {
  /* ignora */
}
