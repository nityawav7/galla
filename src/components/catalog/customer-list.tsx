import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { type Customer } from "@/server/db/repos/customers.repo";
import { formatINR } from "@/server/domain/money";
import { formatIndianPhone } from "@/server/domain/phone";
import { findState } from "@/server/domain/states";

interface CustomerListProps {
  businessSlug: string;
  customers: Customer[];
}

/** One list for every width: name, then phone, GSTIN, place and opening balance. */
export async function CustomerList({ businessSlug, customers }: CustomerListProps) {
  const t = await getTranslations("customers");
  const balance = (paise: bigint) => {
    if (paise === 0n) return null;
    return paise > 0n
      ? t("owes", { amount: formatINR(paise) })
      : t("advance", { amount: formatINR(-paise) });
  };

  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {customers.map((customer) => {
        const place = [
          customer.billingCity,
          customer.billingStateCode ? findState(customer.billingStateCode)?.name : null,
        ]
          .filter(Boolean)
          .join(", ");
        const details = [
          customer.phoneE164 ? formatIndianPhone(customer.phoneE164) : null,
          customer.gstin,
          place || null,
          customer.archivedAt ? t("archived") : null,
        ].filter(Boolean);
        const owed = balance(customer.openingBalancePaise);
        return (
          <li key={customer.id}>
            <Link
              href={`/b/${businessSlug}/customers/${customer.id}`}
              className="flex flex-col gap-0.5 p-3 focus-visible:bg-muted focus-visible:outline-none md:flex-row md:items-baseline md:justify-between md:gap-4"
            >
              <span className="font-medium">{customer.name}</span>
              <span className="flex flex-col text-xs text-muted-foreground md:items-end">
                {details.length > 0 ? <span>{details.join(" · ")}</span> : null}
                {owed ? <span className="tabular-nums">{owed}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
