"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import {
  createProductAction,
  updateProductAction,
} from "@/app/(app)/b/[businessSlug]/products/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  type ProductFormValues,
  type ProductInput,
  productSchema,
} from "@/lib/validation/products";

import { CheckboxField } from "./checkbox-field";
import { SelectField } from "./select-field";
import { applyServerErrors } from "./server-errors";
import { TextField } from "./text-field";
import { useFormMessages } from "./use-form-messages";

export interface ProductFormOptionsProps {
  units: { code: string; label: string }[];
  rates: { rateBp: number; label: string }[];
}

interface ProductFormProps {
  businessSlug: string;
  /** Absent when adding a product. */
  productId?: string;
  defaultValues: ProductFormValues;
  options: ProductFormOptionsProps;
  /** False for composition and unregistered businesses: the rate is kept for later. */
  chargesGst: boolean;
}

type Status = "idle" | "saved" | "error";

export function ProductForm({
  businessSlug,
  productId,
  defaultValues,
  options,
  chargesGst,
}: ProductFormProps) {
  const t = useTranslations("products");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const { fieldError } = useFormMessages();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const schema = useMemo(
    () =>
      productSchema({
        units: options.units.map((unit) => unit.code),
        rateBps: options.rates.map((rate) => rate.rateBp),
      }),
    [options],
  );
  const form = useForm<ProductFormValues, unknown, ProductInput>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onTouched",
  });
  const { register, formState } = form;
  const fieldErrors = formState.errors;

  const submit = form.handleSubmit(async () => {
    setStatus("idle");
    const values = form.getValues();
    if (productId) {
      const result = await updateProductAction(businessSlug, productId, values);
      if (result.ok) {
        setStatus("saved");
        form.reset(values);
        router.refresh();
        return;
      }
      if (applyServerErrors(form, result.error) === undefined) setStatus("error");
      return;
    }
    const result = await createProductAction(businessSlug, values);
    if (result.ok) {
      router.push(`/b/${businessSlug}/products`);
      return;
    }
    if (applyServerErrors(form, result.error) === undefined) setStatus("error");
  });

  return (
    <form
      noValidate
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => void submit(event)}
    >
      <TextField
        label={t("fields.name")}
        error={fieldError(fieldErrors.name)}
        {...register("name")}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={t("fields.price")}
          hint={t("hints.price")}
          inputMode="decimal"
          error={fieldError(fieldErrors.price)}
          {...register("price")}
        />
        <SelectField
          label={t("fields.unit")}
          error={fieldError(fieldErrors.unit)}
          {...register("unit")}
        >
          {options.units.map((unit) => (
            <option key={unit.code} value={unit.code}>
              {unit.code} – {unit.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label={t("fields.rateBp")}
          error={fieldError(fieldErrors.rateBp)}
          {...register("rateBp")}
        >
          {options.rates.map((rate) => (
            <option key={rate.rateBp} value={String(rate.rateBp)}>
              {rate.label}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t("fields.hsnSac")}
          hint={t("hints.hsnSac")}
          inputMode="numeric"
          maxLength={8}
          error={fieldError(fieldErrors.hsnSac)}
          {...register("hsnSac")}
        />
      </div>
      {chargesGst ? null : <p className="text-xs text-muted-foreground">{t("hints.rateNoGst")}</p>}
      <CheckboxField
        label={t("fields.priceIncludesTax")}
        hint={t("hints.priceIncludesTax")}
        error={fieldError(fieldErrors.priceIncludesTax)}
        {...register("priceIncludesTax")}
      />
      <TextField
        label={t("fields.sku")}
        hint={t("hints.sku")}
        autoCapitalize="characters"
        error={fieldError(fieldErrors.sku)}
        {...register("sku")}
      />
      <div className="flex flex-col gap-3" aria-live="polite">
        {status === "saved" ? <p className="text-sm">{t("saved")}</p> : null}
        {status === "error" ? (
          <Alert variant="destructive">
            <AlertDescription>{errors("generic")}</AlertDescription>
          </Alert>
        ) : null}
        <div>
          <Button type="submit" size="lg" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? common("pleaseWait") : productId ? t("save") : t("create")}
          </Button>
        </div>
      </div>
    </form>
  );
}
