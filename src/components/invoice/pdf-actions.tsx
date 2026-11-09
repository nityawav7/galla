"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { SelectField } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import { type PdfFormat } from "@/server/pdf/formats";

/*
 * "Download PDF" and "Print" for an issued invoice or credit note (SPEC F4, F5). Print opens the
 * PDF in a new tab, where the browser's own print button prints it (decision 13). The paper size
 * is remembered on this device only: a shop with a thermal printer picks 80 mm once.
 */

const STORAGE_KEY = "galla.pdfFormat";
const listeners = new Set<() => void>();
/** Used when the browser refuses storage (private mode), so the choice still works this visit. */
let fallback: PdfFormat | null = null;

function readFormat(): PdfFormat {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "80mm" || stored === "a4") return stored;
  } catch {
    // Storage blocked: use the in-memory choice.
  }
  return fallback ?? "a4";
}

function writeFormat(format: PdfFormat): void {
  fallback = format;
  try {
    window.localStorage.setItem(STORAGE_KEY, format);
  } catch {
    // Storage blocked: the in-memory choice is enough.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** `href` is the document's PDF route, e.g. `/b/{slug}/invoices/{id}/pdf`. */
export function PdfActions({ href }: { href: string }) {
  const t = useTranslations("pdf.actions");
  const format = useSyncExternalStore(subscribe, readFormat, () => "a4" as const);
  const url = (download: boolean) => `${href}?format=${format}${download ? "&download=1" : ""}`;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Button asChild size="lg" variant="outline">
        <a href={url(true)} download>
          {t("download")}
        </a>
      </Button>
      <Button asChild size="lg" variant="outline">
        <a href={url(false)} target="_blank" rel="noopener">
          {t("print")}
          <span className="sr-only"> {t("opensInNewTab")}</span>
        </a>
      </Button>
      <div className="w-44">
        <SelectField
          label={t("paper")}
          value={format}
          onChange={(event) => {
            writeFormat(event.target.value === "80mm" ? "80mm" : "a4");
          }}
        >
          <option value="a4">{t("a4")}</option>
          <option value="80mm">{t("thermal")}</option>
        </SelectField>
      </div>
    </div>
  );
}
