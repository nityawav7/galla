import { encode } from "uqr";

export interface QrPath {
  /** Modules per side, including the 4-module quiet zone scanners need. */
  size: number;
  /** One SVG path of every dark module, in module units (draw it in a `size × size` box). */
  d: string;
}

/** The quiet zone the QR standard asks for around the code. */
const QUIET_ZONE = 4;

/**
 * A QR code as a single vector path, for the PDF (`<Svg><Path>`) and the web (`<svg><path>`),
 * so no canvas or image is needed. Error correction M survives a crease or a smudge on a printed
 * invoice and keeps a UPI link at a size phones scan easily.
 */
export function qrPath(text: string): QrPath {
  const { data, size } = encode(text, { ecc: "M", border: QUIET_ZONE });
  const parts: string[] = [];
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${String(x)} ${String(y)}h1v1h-1z`);
    });
  });
  return { size, d: parts.join("") };
}
