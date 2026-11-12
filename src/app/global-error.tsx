"use client";

import Link from "next/link";
import { useEffect } from "react";

import { FATAL_ERROR_MESSAGE } from "@/lib/i18n/fatal-error";
import { reportError } from "@/lib/observability/browser";

/**
 * The last resort when the root layout itself fails: it replaces the whole page, so it has no
 * translations provider and shows both languages (src/lib/i18n/fatal-error.ts). Reports the error to Sentry (ADR 0016).
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", lineHeight: 1.5 }}>
        <main>
          <h1>{FATAL_ERROR_MESSAGE.en}</h1>
          <p lang="hi">{FATAL_ERROR_MESSAGE.hi}</p>
          <p>
            <Link href="/">Galla</Link>
          </p>
        </main>
      </body>
    </html>
  );
}
