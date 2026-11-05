"use client";

import { useTranslations } from "next-intl";

import {
  importCustomersAction,
  previewCustomerImportAction,
} from "@/app/(app)/b/[businessSlug]/customers/actions";
import { CUSTOMER_CSV_TEMPLATE, type CustomerPreviewRow } from "@/lib/validation/customers";

import { CsvImport } from "./csv-import";

function SampleList({ rows }: { rows: CustomerPreviewRow[] }) {
  const t = useTranslations("import");
  const customers = useTranslations("customers");
  const balance = (row: CustomerPreviewRow) =>
    row.balance === null
      ? null
      : row.advance
        ? customers("advance", { amount: row.balance })
        : customers("owes", { amount: row.balance });
  return (
    <ul className="flex flex-col divide-y rounded-lg border text-sm">
      {rows.map((row) => (
        <li key={row.line} className="flex flex-wrap items-baseline justify-between gap-x-3 p-2">
          <span className="font-medium">{row.name}</span>
          <span className="text-muted-foreground">
            {[row.phone, row.gstin, row.state, balance(row)].filter(Boolean).join(" · ")}
          </span>
          <span className="sr-only">{t("line", { line: row.line })}</span>
        </li>
      ))}
    </ul>
  );
}

export function CustomerImport({ businessSlug }: { businessSlug: string }) {
  const t = useTranslations("import");
  return (
    <CsvImport<CustomerPreviewRow>
      templateRows={CUSTOMER_CSV_TEMPLATE}
      templateFileName="galla-customers-template.csv"
      preview={(text) => previewCustomerImportAction(businessSlug, text)}
      commit={(text) => importCustomersAction(businessSlug, text)}
      renderSample={(rows) => <SampleList rows={rows} />}
      importedMessage={(count) => t("customersImported", { count })}
      conflictMessage={t("customersConflict")}
      doneHref={`/b/${businessSlug}/customers`}
      doneLabel={t("viewCustomers")}
    />
  );
}
