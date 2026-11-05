"use client";

import { useTranslations } from "next-intl";

import {
  importProductsAction,
  previewProductImportAction,
} from "@/app/(app)/b/[businessSlug]/products/actions";
import { type ImportPreviewRow, PRODUCT_CSV_TEMPLATE } from "@/lib/validation/products";

import { CsvImport } from "./csv-import";

function SampleList({ rows }: { rows: ImportPreviewRow[] }) {
  const t = useTranslations("import");
  return (
    <ul className="flex flex-col divide-y rounded-lg border text-sm">
      {rows.map((row) => (
        <li key={row.line} className="flex flex-wrap items-baseline justify-between gap-x-3 p-2">
          <span className="font-medium">{row.name}</span>
          <span className="text-muted-foreground">
            {row.price} / {row.unit} · {row.rate}
            {row.sku ? ` · ${row.sku}` : ""}
          </span>
          <span className="sr-only">{t("line", { line: row.line })}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProductImport({ businessSlug }: { businessSlug: string }) {
  const t = useTranslations("import");
  return (
    <CsvImport<ImportPreviewRow>
      templateRows={PRODUCT_CSV_TEMPLATE}
      templateFileName="galla-products-template.csv"
      preview={(text) => previewProductImportAction(businessSlug, text)}
      commit={(text) => importProductsAction(businessSlug, text)}
      renderSample={(rows) => <SampleList rows={rows} />}
      importedMessage={(count) => t("imported", { count })}
      conflictMessage={t("conflict")}
      doneHref={`/b/${businessSlug}/products`}
      doneLabel={t("viewList")}
    />
  );
}
