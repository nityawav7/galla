"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { type UseFormRegisterReturn } from "react-hook-form";

import {
  getCustomerOptionAction,
  searchCustomersAction,
} from "@/app/(app)/b/[businessSlug]/invoices/actions";
import { CustomerForm } from "@/components/forms/customer-form";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type CustomerOption } from "@/lib/invoice-options";
import { EMPTY_CUSTOMER_FORM } from "@/lib/validation/customers";
import { formatIndianPhone } from "@/server/domain/phone";
import { findState } from "@/server/domain/states";

import { useSearch } from "./use-search";

interface CustomerPickerProps {
  businessSlug: string;
  customer: CustomerOption | null;
  /** The walk-in name input, registered on the builder's form. */
  walkInField: UseFormRegisterReturn<"walkInName">;
  onChange: (customer: CustomerOption | null) => void;
  /** Can add customers (catalog:write); the builder's users always can today. */
  canCreate: boolean;
  /** Already translated. */
  error?: string | undefined;
}

function stateLabel(code: string | null): string | null {
  if (!code) return null;
  const state = findState(code);
  return state ? `${state.name} (${state.code})` : code;
}

/** SPEC F4: pick a customer, add one inline, or bill a walk-in buyer. */
export function CustomerPicker({
  businessSlug,
  customer,
  walkInField,
  onChange,
  canCreate,
  error,
}: CustomerPickerProps) {
  const t = useTranslations("invoices.builder");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const search = useCallback((q: string) => searchCustomersAction(businessSlug, q), [businessSlug]);
  const { results, loading, failed } = useSearch(open, query, search);

  const choose = (option: CustomerOption | null) => {
    onChange(option);
    setOpen(false);
    setQuery("");
  };

  const created = async (customerId: string) => {
    setCreating(false);
    const result = await getCustomerOptionAction(businessSlug, customerId);
    if (result.ok) choose(result.data);
  };

  return (
    <section aria-labelledby="builder-customer" className="flex flex-col gap-3">
      <h2 id="builder-customer" className="text-lg font-semibold">
        {t("customer")}
      </h2>

      {customer ? (
        <div className="flex flex-col gap-1 rounded-lg border p-3">
          <p className="font-medium">{customer.name}</p>
          <p className="text-sm text-muted-foreground">
            {[
              customer.gstin,
              customer.phoneE164 ? formatIndianPhone(customer.phoneE164) : null,
              stateLabel(customer.shippingStateCode ?? customer.billingStateCode),
            ]
              .filter(Boolean)
              .join(" · ") || t("noCustomerDetails")}
          </p>
        </div>
      ) : (
        <TextField
          label={t("walkInName")}
          hint={t("walkInHint")}
          autoComplete="off"
          maxLength={120}
          {...walkInField}
        />
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          aria-expanded={open}
          aria-controls="customer-search-panel"
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {customer ? t("changeCustomer") : t("chooseCustomer")}
        </Button>
        {customer ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => {
              choose(null);
            }}
          >
            {t("useWalkIn")}
          </Button>
        ) : null}
        {canCreate ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => {
              setCreating(true);
            }}
          >
            {t("newCustomer")}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div id="customer-search-panel" className="flex flex-col gap-2 rounded-lg border p-3">
          <TextField
            label={t("searchCustomers")}
            type="search"
            autoFocus
            autoComplete="off"
            placeholder={t("searchCustomersPlaceholder")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <div aria-live="polite" className="text-sm text-muted-foreground">
            {loading ? t("searching") : failed ? t("searchFailed") : null}
            {!loading && !failed && results.length === 0 ? t("noCustomers") : null}
          </div>
          <ul className="flex flex-col divide-y">
            {results.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => {
                    choose(option);
                  }}
                >
                  <span className="font-medium">{option.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {[option.gstin, option.phoneE164 ? formatIndianPhone(option.phoneE164) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogTitle>{t("newCustomer")}</DialogTitle>
          <DialogDescription>{t("newCustomerHint")}</DialogDescription>
          <CustomerForm
            businessSlug={businessSlug}
            defaultValues={EMPTY_CUSTOMER_FORM}
            onSaved={(id) => void created(id)}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
