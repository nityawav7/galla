import { getTranslations } from "next-intl/server";

import { amountInWords } from "@/server/domain/amount-in-words";
import { formatIndianDate } from "@/server/domain/fy";
import { type AddressSnapshot } from "@/server/domain/invoice/snapshot";
import { type DisplayStatus } from "@/server/domain/invoice/status";
import { formatINR } from "@/server/domain/money";
import { formatIndianPhone } from "@/server/domain/phone";
import { formatQuantity } from "@/server/domain/quantity";
import { findState } from "@/server/domain/states";
import type { Invoice, InvoiceLine } from "@/server/services/invoice.service";

import { StatusBadge } from "./status-badge";

function stateName(code: string | null): string | null {
  if (!code) return null;
  const state = findState(code);
  return state ? `${state.name} (${state.code})` : code;
}

function addressLines(address: AddressSnapshot | null): string[] {
  if (!address) return [];
  const cityLine = [address.city, address.pincode].filter(Boolean).join(" ");
  return [address.line1, address.line2, cityLine, stateName(address.stateCode)].filter(
    (part): part is string => Boolean(part),
  );
}

const percent = (rateBp: number) => `${String(rateBp / 100)}%`;

/**
 * An issued invoice on screen, with every Rule 46 field (SPEC §4.7). It reads only the
 * snapshots on the invoice, never the current customer or business. The PDF comes in Phase 7.
 */
export async function InvoiceView({
  invoice,
  lines,
  status,
}: {
  invoice: Invoice;
  lines: InvoiceLine[];
  status: DisplayStatus;
}) {
  const t = await getTranslations("invoices.view");
  const supplier = invoice.supplierSnapshot;
  const recipient = invoice.customerSnapshot;
  const withTax = invoice.type === "TAX_INVOICE";
  const tax = (line: InvoiceLine) =>
    line.cgstPaise + line.sgstPaise + line.utgstPaise + line.igstPaise;

  return (
    <article className="flex flex-col gap-5 rounded-xl border bg-card p-4 text-sm shadow-sm">
      <header className="flex flex-col gap-1 border-b pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t(`type.${invoice.type}`)}</h2>
          <StatusBadge status={status} />
        </div>
        {invoice.type === "BILL_OF_SUPPLY" ? (
          <p className="text-xs text-muted-foreground">{t("compositionLine")}</p>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">{t("number")}</dt>
          <dd className="font-medium whitespace-nowrap">{invoice.number ?? "—"}</dd>
          <dt className="text-muted-foreground">{t("date")}</dt>
          <dd>{formatIndianDate(invoice.invoiceDate)}</dd>
          {invoice.dueDate ? (
            <>
              <dt className="text-muted-foreground">{t("dueDate")}</dt>
              <dd>{formatIndianDate(invoice.dueDate)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t("placeOfSupply")}</dt>
          <dd>{stateName(invoice.placeOfSupplyStateCode)}</dd>
          <dt className="text-muted-foreground">{t("reverseCharge")}</dt>
          <dd>{t("no")}</dd>
        </dl>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="invoice-supplier">
          <h3 id="invoice-supplier" className="text-xs font-medium text-muted-foreground uppercase">
            {t("from")}
          </h3>
          {supplier ? (
            <>
              <p className="font-medium">{supplier.tradeName ?? supplier.legalName}</p>
              {supplier.tradeName ? <p>{supplier.legalName}</p> : null}
              {addressLines(supplier.address).map((part) => (
                <p key={part}>{part}</p>
              ))}
              {supplier.gstin ? <p>{t("gstin", { gstin: supplier.gstin })}</p> : null}
              {supplier.phoneE164 ? <p>{formatIndianPhone(supplier.phoneE164)}</p> : null}
            </>
          ) : null}
        </section>
        <section aria-labelledby="invoice-recipient">
          <h3
            id="invoice-recipient"
            className="text-xs font-medium text-muted-foreground uppercase"
          >
            {t("billedTo")}
          </h3>
          <p className="font-medium">
            {recipient && recipient.name.length > 0 ? recipient.name : t("walkIn")}
          </p>
          {addressLines(recipient?.billing ?? null).map((part) => (
            <p key={part}>{part}</p>
          ))}
          {recipient?.gstin ? <p>{t("gstin", { gstin: recipient.gstin })}</p> : null}
          {recipient?.shipping ? (
            <>
              <h4 className="mt-2 text-xs font-medium text-muted-foreground uppercase">
                {t("shipTo")}
              </h4>
              {addressLines(recipient.shipping).map((part) => (
                <p key={part}>{part}</p>
              ))}
            </>
          ) : null}
        </section>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left">
          <caption className="sr-only">{t("items")}</caption>
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-2">
                {t("item")}
              </th>
              <th scope="col" className="py-1 pr-2">
                {t("hsn")}
              </th>
              <th scope="col" className="py-1 pr-2 text-right">
                {t("qty")}
              </th>
              <th scope="col" className="py-1 pr-2 text-right">
                {t("price")}
              </th>
              <th scope="col" className="py-1 pr-2 text-right">
                {t("discount")}
              </th>
              <th scope="col" className="py-1 pr-2 text-right">
                {t("taxable")}
              </th>
              {withTax ? (
                <th scope="col" className="py-1 pr-2 text-right">
                  {t("gst")}
                </th>
              ) : null}
              <th scope="col" className="py-1 text-right">
                {t("amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b align-top">
                <td className="py-1.5 pr-2">{line.description}</td>
                <td className="py-1.5 pr-2">{line.hsnSac ?? "—"}</td>
                <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                  {formatQuantity(line.qtyMilli)} {line.unit}
                </td>
                <td className="py-1.5 pr-2 text-right">{formatINR(line.unitPricePaise)}</td>
                <td className="py-1.5 pr-2 text-right">{formatINR(line.discountPaise)}</td>
                <td className="py-1.5 pr-2 text-right">{formatINR(line.taxablePaise)}</td>
                {withTax ? (
                  <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                    {percent(line.rateBp)} · {formatINR(tax(line))}
                  </td>
                ) : null}
                <td className="py-1.5 text-right">{formatINR(line.lineTotalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-1">
        <dt>{t("taxable")}</dt>
        <dd className="text-right">{formatINR(invoice.taxablePaise)}</dd>
        {invoice.cgstPaise > 0n ? (
          <>
            <dt>{t("cgst")}</dt>
            <dd className="text-right">{formatINR(invoice.cgstPaise)}</dd>
          </>
        ) : null}
        {invoice.sgstPaise > 0n ? (
          <>
            <dt>{t("sgst")}</dt>
            <dd className="text-right">{formatINR(invoice.sgstPaise)}</dd>
          </>
        ) : null}
        {invoice.utgstPaise > 0n ? (
          <>
            <dt>{t("utgst")}</dt>
            <dd className="text-right">{formatINR(invoice.utgstPaise)}</dd>
          </>
        ) : null}
        {invoice.igstPaise > 0n ? (
          <>
            <dt>{t("igst")}</dt>
            <dd className="text-right">{formatINR(invoice.igstPaise)}</dd>
          </>
        ) : null}
        {invoice.roundOffPaise !== 0n ? (
          <>
            <dt>{t("roundOff")}</dt>
            <dd className="text-right">{formatINR(invoice.roundOffPaise)}</dd>
          </>
        ) : null}
        <dt className="font-semibold">{t("total")}</dt>
        <dd className="text-right font-semibold" data-testid="invoice-total">
          {formatINR(invoice.grandTotalPaise)}
        </dd>
      </dl>
      <p className="text-xs">{amountInWords(invoice.grandTotalPaise)}</p>
      {invoice.notes ? <p className="whitespace-pre-line">{invoice.notes}</p> : null}
      <p className="text-right text-xs text-muted-foreground">{t("signatory")}</p>
    </article>
  );
}
