"use client";

import { useTranslations } from "next-intl";
import { type UseFormRegister } from "react-hook-form";

import { CheckboxField } from "@/components/forms/checkbox-field";
import { SelectField } from "@/components/forms/select-field";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { type DraftLine, type InvoiceDraft } from "@/lib/validation/invoices";
import { isValidationKey } from "@/lib/validation/messages";
import { type LineAmounts } from "@/server/domain/gst/calc";
import { type TaxMode } from "@/server/domain/gst/place-of-supply";
import { formatINR } from "@/server/domain/money";

interface LineCardProps {
  index: number;
  line: DraftLine;
  register: UseFormRegister<InvoiceDraft>;
  /** Present when the line is valid. */
  amounts: LineAmounts | undefined;
  /** `validation.*` keys by field. */
  issues: Record<string, string>;
  /** Show errors on untouched (empty) fields too, after an issue attempt. */
  showAllErrors: boolean;
  taxMode: TaxMode;
  rates: { rateBp: number; label: string }[];
  units: { code: string; label: string }[];
  onRemove: () => void;
}

type Field = "description" | "qty" | "unitPrice" | "discount" | "hsnSac" | "unit" | "rateBp";

function percent(rateBp: number): string {
  return `${String(rateBp / 100)}%`;
}

/** One line of the invoice builder: thumb-sized inputs on a phone, a row of fields on desktop. */
export function LineCard({
  index,
  line,
  register,
  amounts,
  issues,
  showAllErrors,
  taxMode,
  rates,
  units,
  onRemove,
}: LineCardProps) {
  const t = useTranslations("invoices.builder");
  const validation = useTranslations("validation");
  const name = <F extends keyof DraftLine>(field: F) => `lines.${index}.${field}` as const;

  const errorFor = (field: Field): string | undefined => {
    const key = issues[field];
    const typed = String(line[field]).trim() !== "";
    if (!key || !isValidationKey(key) || (!showAllErrors && !typed)) return undefined;
    return validation(key);
  };
  const withTax = taxMode !== "NONE";
  const fromProduct = line.productId !== null;
  const tax = amounts
    ? amounts.cgstPaise + amounts.sgstPaise + amounts.utgstPaise + amounts.igstPaise
    : null;

  return (
    <li
      className="flex flex-col gap-3 rounded-lg border p-3"
      aria-label={t("lineLabel", { n: index + 1 })}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <TextField
            label={t("fields.description")}
            autoComplete="off"
            maxLength={200}
            error={errorFor("description")}
            {...register(name("description"))}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="mt-6"
          aria-label={t("removeLine", { n: index + 1 })}
          onClick={onRemove}
        >
          {t("remove")}
        </Button>
      </div>

      {fromProduct ? (
        <p className="text-xs text-muted-foreground">
          {[
            line.hsnSac ? t("hsnValue", { hsn: line.hsnSac }) : t("noHsn"),
            line.unit,
            withTax ? percent(line.rateBp) : null,
            withTax && line.priceIncludesTax ? t("inclusive") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <TextField
            label={t("fields.hsnSac")}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            error={errorFor("hsnSac")}
            {...register(name("hsnSac"))}
          />
          <SelectField
            label={t("fields.unit")}
            error={errorFor("unit")}
            {...register(name("unit"))}
          >
            {units.map((unit) => (
              <option key={unit.code} value={unit.code}>
                {unit.code} – {unit.label}
              </option>
            ))}
          </SelectField>
          {withTax ? (
            <>
              <SelectField
                label={t("fields.rate")}
                error={errorFor("rateBp")}
                {...register(name("rateBp"), { valueAsNumber: true })}
              >
                {rates.map((rate) => (
                  <option key={rate.rateBp} value={rate.rateBp}>
                    {rate.label}
                  </option>
                ))}
              </SelectField>
              <div className="flex items-end pb-1">
                <CheckboxField
                  label={t("fields.priceIncludesTax")}
                  {...register(name("priceIncludesTax"))}
                />
              </div>
            </>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <TextField
          label={t("fields.qty")}
          inputMode="decimal"
          autoComplete="off"
          maxLength={20}
          error={errorFor("qty")}
          {...register(name("qty"))}
        />
        <TextField
          label={t("fields.unitPrice")}
          inputMode="decimal"
          autoComplete="off"
          maxLength={20}
          error={errorFor("unitPrice")}
          {...register(name("unitPrice"))}
        />
        <div className="col-span-2 sm:col-span-1">
          <TextField
            label={t("fields.discount")}
            inputMode="decimal"
            autoComplete="off"
            maxLength={20}
            placeholder="0"
            error={errorFor("discount")}
            {...register(name("discount"))}
          />
        </div>
      </div>

      <p className="flex justify-between text-sm">
        <span className="text-muted-foreground">
          {amounts && tax !== null && withTax
            ? t("lineTax", { taxable: formatINR(amounts.taxablePaise), tax: formatINR(tax) })
            : null}
        </span>
        <span className="font-medium" data-testid={`line-total-${String(index)}`}>
          {amounts ? formatINR(amounts.totalPaise) : "—"}
        </span>
      </p>
    </li>
  );
}
