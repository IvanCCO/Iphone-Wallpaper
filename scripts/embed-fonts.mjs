// Gera src/render/fonts.generated.ts com a fonte Inter (OFL) embutida em base64.
// Motivo: funciona igual local, em testes e na Vercel, sem depender de fs/rastreamento de arquivos.
// Satori aceita TTF/OTF/WOFF (não WOFF2). Subconjunto "latin" cobre pt-BR.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "node_modules", "@fontsource", "inter");
const weights = [400, 600, 700];

let out = "// ARQUIVO GERADO por scripts/embed-fonts.mjs. Não edite à mão.\n";
out += "// Fonte: Inter (SIL Open Font License 1.1), via @fontsource/inter. Licença em third_party/inter/LICENSE.\n\n";
out += "export const INTER_WOFF_BASE64: Record<400 | 600 | 700, string> = {\n";
for (const w of weights) {
  const b64 = readFileSync(join(pkg, "files", `inter-latin-${w}-normal.woff`)).toString("base64");
  out += `  ${w}: "${b64}",\n`;
}
out += "};\n";
writeFileSync(join(root, "src", "render", "fonts.generated.ts"), out);

mkdirSync(join(root, "third_party", "inter"), { recursive: true });
copyFileSync(join(pkg, "LICENSE"), join(root, "third_party", "inter", "LICENSE"));
console.log("fonts.generated.ts escrito");
