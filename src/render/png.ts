import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { INTER_WOFF_BASE64 } from "./fonts.generated.js";
import { buildLayout, type LayoutInput, type LayoutResult } from "./layout.js";

const toArrayBuffer = (b64: string): ArrayBuffer => {
  const buf = Buffer.from(b64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

let fonts: { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" }[] | undefined;
const getFonts = () =>
  (fonts ??= ([400, 600, 700] as const).map((weight) => ({
    name: "Inter",
    data: toArrayBuffer(INTER_WOFF_BASE64[weight]),
    weight,
    style: "normal" as const,
  })));

export interface RenderedImage {
  png: Buffer;
  layout: LayoutResult;
}

/** Layout (Satori) → SVG → PNG (resvg). O texto vira path, então resvg não precisa de fontes. */
export async function renderTasksPng(input: LayoutInput): Promise<RenderedImage> {
  const layout = buildLayout(input);
  const svg = await satori(layout.root as never, { width: input.width, height: input.height, fonts: getFonts() });
  const png = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  return { png, layout };
}
