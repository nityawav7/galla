"use client";

import { useTranslations } from "next-intl";

import { firstInvoiceNumber } from "@/components/forms/business-fields";
import { type BusinessFormValues } from "@/lib/validation/business";
import { istDateFromInstant } from "@/server/domain/fy";
import { documentTypeFor } from "@/server/domain/gst/place-of-supply";
import { formatIndianPhone, normalizeIndianPhone } from "@/server/domain/phone";
import { findState } from "@/server/domain/states";
import { isValidUpiVpa, normalizeUpiVpa } from "@/server/domain/upi";

function formatIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day ?? ""}/${month ?? ""}/${year ?? ""}`;
}

/**
 * The top and bottom of an invoice as it will print, updating while the owner types
 * (SPEC F1). Items and taxes are left out: they come from Phase 6's real calculation.
 */
export function InvoicePreview({ values }: { values: BusinessFormValues }) {
  const t = useTranslations("preview");
  const documentType = documentTypeFor(values.gstScheme);
  const name = values.tradeName.trim() || values.legalName.trim();
  const showLegalName = Boolean(values.tradeName.trim() && values.legalName.trim());
  const state = findState(values.stateCode);
  const phone = normalizeIndianPhone(values.phone);
  const gstin = values.gstin.trim().toUpperCase();
  const upi = isValidUpiVpa(values.upiVpa) ? normalizeUpiVpa(values.upiVpa) : undefined;
  const number = firstInvoiceNumber(values.invoicePrefix) ?? "—";
  const cityLine = [values.city.trim(), values.pincode.trim()].filter(Boolean).join(" ");

  return (
    <section
      aria-label={t("label")}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-sm shadow-sm"
    >
      <p className="text-xs text-muted-foreground">{t("sample")}</p>
      <header className="flex flex-col gap-0.5 border-b pb-3">
        <p className="text-center text-xs font-semibold tracking-wide uppercase">
          {t(`titles.${documentType}`)}
        </p>
        <p className="text-lg font-semibold">{name || t("yourBusiness")}</p>
        {showLegalName ? <p className="text-muted-foreground">{values.legalName}</p> : null}
        {values.addressLine1.trim() ? <p>{values.addressLine1}</p> : null}
        {values.addressLine2.trim() ? <p>{values.addressLine2}</p> : null}
        {cityLine ? <p>{cityLine}</p> : null}
        {state ? (
          <p>
            {state.name} ({state.code})
          </p>
        ) : null}
        {phone ? <p>{t("phone", { phone: formatIndianPhone(phone) })}</p> : null}
        <p className="font-medium">
          {values.gstScheme === "UNREGISTERED"
            ? t("unregistered")
            : t("gstin", { gstin: gstin || "—" })}
        </p>
        {values.gstScheme === "COMPOSITION" ? (
          <p className="text-xs">{t("compositionNote")}</p>
        ) : null}
      </header>
      <dl className="grid grid-cols-2 gap-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("number")}</dt>
          <dd className="font-mono">{number}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("date")}</dt>
          <dd>{formatIsoDate(istDateFromInstant(new Date()))}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">{t("billTo")}</dt>
          <dd>{t("sampleCustomer")}</dd>
        </div>
      </dl>
      <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">
        {t("itemsPlaceholder")}
      </p>
      {upi ? <p className="font-medium">{t("payByUpi", { upi })}</p> : null}
    </section>
  );
}
