import { qrPath } from "@/lib/qr";

/**
 * The UPI payment QR as inline SVG (no image request, no client JavaScript). Dark modules on a
 * white square with the quiet zone included, so it scans in dark mode too.
 */
export function UpiQr({ link, label, size = 176 }: { link: string; label: string; size?: number }) {
  const qr = qrPath(link);
  const box = String(qr.size);
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      shapeRendering="crispEdges"
      className="shrink-0 rounded-md"
    >
      <rect width={box} height={box} fill="#ffffff" />
      <path d={qr.d} fill="#000000" />
    </svg>
  );
}
