import path from "node:path";

import { Font } from "@react-pdf/renderer";

/**
 * Noto Sans for Latin text and ₹, Noto Sans Devanagari for Hindi (SPEC F5, ADR 0008). Styles use
 * `fontFamily: PDF_FONTS`, so react-pdf falls back to Devanagari per character and a line can
 * mix both scripts. The TTFs live next to this file (OFL licence, see fonts/README.md);
 * next.config.ts traces them into the Vercel functions that render PDFs.
 */
export const PDF_FONTS = ["NotoSans", "NotoSansDevanagari"];

const FONT_DIR = path.join(process.cwd(), "src", "server", "pdf", "fonts");

let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSans-Regular.ttf") },
      { src: path.join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "NotoSansDevanagari",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSansDevanagari-Regular.ttf") },
      { src: path.join(FONT_DIR, "NotoSansDevanagari-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // Never hyphenate: item names, GSTINs and numbers must print as typed.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
