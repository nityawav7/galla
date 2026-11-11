"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import {
  deleteDraftAction,
  type IssueActionResult,
  issueInvoiceAction,
} from "@/app/(app)/b/[businessSlug]/invoices/actions";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { SelectField } from "@/components/forms/select-field";
import { TextField } from "@/components/forms/text-field";
import { PdfActions } from "@/components/invoice/pdf-actions";
import { CopyLink } from "@/components/invoice/public-link-panel";
import { WhatsAppShare } from "@/components/invoice/whatsapp-share";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type FieldIssue } from "@/lib/errors";
import { RECIPIENT_DETAILS_THRESHOLD_PAISE } from "@/lib/gst-config";
import { evaluateDraft, lineIssues } from "@/lib/invoice-evaluation";
import { type CustomerOption, type ProductOption } from "@/lib/invoice-options";
import { draftSchema, type InvoiceDraft, isInvoiceErrorKey } from "@/lib/validation/invoices";
import { isValidationKey } from "@/lib/validation/messages";
import { formatIndianDate } from "@/server/domain/fy";
import { checkIssuable, type IssueWarning } from "@/server/domain/invoice/issue-rules";
import { formatINR } from "@/server/domain/money";
import { findState } from "@/server/domain/states";
import type { BuilderOptions } from "@/server/services/invoice.service";

import { CustomerPicker } from "./customer-picker";
import { ItemSearch } from "./item-search";
import { LineCard } from "./line-card";
import { useAutosave } from "./use-autosave";

export interface InvoiceBuilderProps {
  businessSlug: string;
  options: BuilderOptions;
  /** Today in Asia/Kolkata (the invoice date if issued now). */
  today: string;
  initial: {
    id: string | null;
    version: number;
    draft: InvoiceDraft;
    customer: CustomerOption | null;
  };
}

type Issued = Extract<IssueActionResult, { status: "issued" }>;

function newKey(): string {
  return crypto.randomUUID();
}

/**
 * The invoice builder (SPEC F4). Totals come from the same `evaluateDraft` and domain engine
 * the server runs; the server recomputes everything anyway when saving and issuing. The draft
 * is a working copy, so the builder is not a submit form: it autosaves, and "Issue" asks the
 * server to issue the saved draft.
 */
export function InvoiceBuilder({ businessSlug, options, today, initial }: InvoiceBuilderProps) {
  const t = useTranslations("invoices.builder");
  const validation = useTranslations("validation");
  const invoiceErrors = useTranslations("invoices.errors");
  const errors = useTranslations("errors");
  const router = useRouter();

  const form = useForm<InvoiceDraft>({ defaultValues: initial.draft });
  const { control, register, setValue } = form;
  const lines = useFieldArray({ control, name: "lines" });
  const watched = useWatch({ control });
  // Inputs carry the schema's length limits, so this parse succeeds; if it ever fails, the
  // builder shows the last loaded draft and stops autosaving rather than save something else.
  const parsed = useMemo(() => draftSchema.safeParse(watched), [watched]);
  const draft = parsed.success ? parsed.data : initial.draft;

  const [customer, setCustomer] = useState<CustomerOption | null>(initial.customer);
  // The field to focus once a new line has rendered (the search panel that had focus is gone).
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const name = focusNext.current;
    if (!name) return;
    const input = document.getElementsByName(name)[0];
    if (!input) return;
    focusNext.current = null;
    input.focus();
  });
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [serverIssues, setServerIssues] = useState<FieldIssue[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [warnings, setWarnings] = useState<IssueWarning[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editPlace, setEditPlace] = useState(draft.placeOfSupplyOverride !== null);

  const autosave = useAutosave({
    businessSlug,
    initialId: initial.id,
    initialVersion: initial.version,
    draft,
    enabled: issued === null && parsed.success,
  });

  const lineOptions = useMemo(
    () => ({
      units: options.units.map((unit) => unit.code),
      rateBps: options.rates.map((rate) => rate.rateBp),
    }),
    [options],
  );
  const evaluation = evaluateDraft({
    draft,
    business: options.business,
    customer,
    options: lineOptions,
    invoiceDate: today,
  });
  const rules = checkIssuable({
    documentType: evaluation.documentType,
    recipient: {
      customerId: customer?.id ?? null,
      name: customer?.name ?? draft.walkInName,
      gstin: customer?.gstin ?? null,
      addressLine1: customer?.billingAddressLine1 ?? null,
      stateCode: customer?.billingStateCode ?? null,
    },
    lines: evaluation.lines.map(({ line }) => line),
    hsnDigitsRequired: options.business.hsnDigitsRequired,
    grandTotalPaise: evaluation.totals.grandTotalPaise,
    recipientDetailsThresholdPaise: RECIPIENT_DETAILS_THRESHOLD_PAISE,
    placeOfSupplyWarnings: evaluation.placeOfSupply?.warnings ?? [],
  });
  const allIssues = [...evaluation.issues, ...(showAllErrors ? rules.errors : []), ...serverIssues];
  const message = (key: string) => (isValidationKey(key) ? validation(key) : key);
  const topIssue = (path: string) => {
    const issue = allIssues.find((candidate) => candidate.path === path);
    return issue && (showAllErrors || path !== "lines") ? message(issue.message) : undefined;
  };

  const { totals, taxMode } = evaluation;
  const place = findState(evaluation.placeOfSupplyStateCode);
  const taxLabel = evaluation.placeOfSupply ? t(`taxMode.${taxMode}`) : null;
  const locked = issued !== null || autosave.status === "conflict";

  const pickCustomer = (option: CustomerOption | null) => {
    setCustomer(option);
    setValue("customerId", option?.id ?? null);
    setServerIssues([]);
  };

  const addProduct = (product: ProductOption) => {
    lines.append(
      {
        key: newKey(),
        productId: product.id,
        description: product.name,
        hsnSac: product.hsnSac ?? "",
        unit: product.unit,
        qty: "1",
        unitPrice: product.price,
        discount: "",
        rateBp: product.rateBp,
        priceIncludesTax: product.priceIncludesTax,
      },
      { shouldFocus: false },
    );
    // Quantity next: the product already brought its price.
    focusNext.current = `lines.${String(lines.fields.length)}.qty`;
  };

  const addOneOff = (description: string) => {
    const next = String(lines.fields.length);
    lines.append(
      {
        key: newKey(),
        productId: null,
        description,
        hsnSac: "",
        unit: options.units.some((unit) => unit.code === "NOS")
          ? "NOS"
          : (options.units[0]?.code ?? ""),
        qty: "1",
        unitPrice: "",
        discount: "",
        rateBp: options.rates.some((rate) => rate.rateBp === 1800)
          ? 1800
          : (options.rates[0]?.rateBp ?? 0),
        priceIncludesTax: false,
      },
      { shouldFocus: false },
    );
    // A named item needs its price next; an unnamed one needs its name.
    focusNext.current = description ? `lines.${next}.unitPrice` : `lines.${next}.description`;
  };

  const issue = async (acknowledgedWarnings: IssueWarning[] = []) => {
    setShowAllErrors(true);
    setProblem(null);
    setServerIssues([]);
    if (evaluation.issues.length > 0 || rules.errors.length > 0) {
      setProblem(t("fixBeforeIssue"));
      return;
    }
    setIssuing(true);
    const saved = await autosave.saveNow();
    const id = autosave.invoiceId();
    if (!saved || !id) {
      setIssuing(false);
      setProblem(t("saveFailed"));
      return;
    }
    const result = await issueInvoiceAction(businessSlug, id, {
      version: autosave.version(),
      acknowledgedWarnings,
    });
    setIssuing(false);
    if (!result.ok) {
      if (result.error.code === "VALIDATION" && result.error.issues?.length) {
        setServerIssues([...result.error.issues]);
        setProblem(t("fixBeforeIssue"));
      } else if (result.error.code === "CONFLICT" && isInvoiceErrorKey(result.error.message)) {
        setProblem(invoiceErrors(result.error.message));
      } else {
        setProblem(errors("generic"));
      }
      return;
    }
    if (result.data.status === "needsConfirmation") {
      setAcknowledged(false);
      setWarnings(result.data.warnings as IssueWarning[]);
      return;
    }
    setWarnings([]);
    setIssued(result.data);
  };

  const removeDraft = async () => {
    const id = autosave.invoiceId();
    setConfirmDelete(false);
    if (id) {
      const result = await deleteDraftAction(businessSlug, id);
      if (!result.ok) {
        setProblem(errors("generic"));
        return;
      }
    }
    router.push(`/b/${businessSlug}/invoices`);
  };

  const conflictText =
    autosave.conflict && isInvoiceErrorKey(autosave.conflict)
      ? invoiceErrors(autosave.conflict)
      : errors("generic");

  return (
    <div className="flex flex-col gap-6 pb-40">
      {autosave.status === "conflict" ? (
        <Alert variant="destructive">
          <AlertDescription>
            {conflictText}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                window.location.reload();
              }}
            >
              {t("reload")}
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      <fieldset disabled={locked} className="flex flex-col gap-6">
        <CustomerPicker
          businessSlug={businessSlug}
          customer={customer}
          walkInField={register("walkInName")}
          onChange={pickCustomer}
          canCreate
          error={topIssue("customerId")}
        />

        <section aria-labelledby="builder-place" className="flex flex-col gap-2">
          <h2 id="builder-place" className="text-lg font-semibold">
            {t("placeOfSupply")}
          </h2>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {taxLabel ? (
              <span
                className="rounded-full bg-secondary px-2.5 py-0.5 font-medium"
                data-testid="tax-mode"
              >
                {taxLabel}
              </span>
            ) : null}
            <span>
              {place ? `${place.name} (${place.code})` : evaluation.placeOfSupplyStateCode}
            </span>
            <button
              type="button"
              className="underline underline-offset-4"
              aria-expanded={editPlace}
              onClick={() => {
                if (editPlace) setValue("placeOfSupplyOverride", null);
                setEditPlace((value) => !value);
              }}
            >
              {editPlace ? t("useAutomaticPlace") : t("changePlace")}
            </button>
          </p>
          {editPlace ? (
            <SelectField
              label={t("placeOfSupplyOverride")}
              {...register("placeOfSupplyOverride", {
                setValueAs: (value: string | null) => (value === "" ? null : value),
              })}
            >
              <option value="">{t("automaticPlace")}</option>
              {options.states.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.name} ({state.code})
                </option>
              ))}
            </SelectField>
          ) : null}
          {(topIssue("placeOfSupply") ?? topIssue("placeOfSupplyOverride")) ? (
            <p className="text-sm text-destructive">
              {topIssue("placeOfSupply") ?? topIssue("placeOfSupplyOverride")}
            </p>
          ) : null}
        </section>

        <section aria-labelledby="builder-items" className="flex flex-col gap-3">
          <h2 id="builder-items" className="text-lg font-semibold">
            {t("items")}
          </h2>
          {lines.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noItems")}</p>
          ) : null}
          <ol className="flex flex-col gap-3">
            {lines.fields.map((field, index) => {
              const line = draft.lines[index];
              if (!line) return null;
              return (
                <LineCard
                  key={field.id}
                  index={index}
                  line={line}
                  register={register}
                  amounts={evaluation.lines.find((evaluated) => evaluated.index === index)?.amounts}
                  issues={lineIssues(allIssues, index)}
                  showAllErrors={showAllErrors}
                  taxMode={taxMode}
                  rates={options.rates}
                  units={options.units}
                  onRemove={() => {
                    lines.remove(index);
                  }}
                />
              );
            })}
          </ol>
          {topIssue("lines") ? (
            <p className="text-sm text-destructive">{topIssue("lines")}</p>
          ) : null}
          <ItemSearch
            businessSlug={businessSlug}
            onAddProduct={addProduct}
            onAddOneOff={addOneOff}
            disabled={locked}
          />
        </section>

        <section aria-labelledby="builder-more" className="flex flex-col gap-3">
          <h2 id="builder-more" className="text-lg font-semibold">
            {t("more")}
          </h2>
          <p className="text-sm">{t("invoiceDate", { date: formatIndianDate(today) })}</p>
          <TextField
            label={t("dueDate")}
            type="date"
            min={today}
            hint={
              evaluation.dueDate && !draft.dueDate
                ? t("dueDateDefault", { date: formatIndianDate(evaluation.dueDate) })
                : undefined
            }
            error={topIssue("dueDate")}
            {...register("dueDate", {
              setValueAs: (value: string | null) => (value === "" ? null : value),
            })}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invoice-notes" className="text-sm font-medium">
              {t("notes")}
            </label>
            <textarea
              id="invoice-notes"
              rows={2}
              maxLength={500}
              className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              {...register("notes")}
            />
          </div>
          {initial.id || autosave.invoiceId() ? (
            <div>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setConfirmDelete(true);
                }}
              >
                {t("deleteDraft")}
              </Button>
            </div>
          ) : null}
        </section>
      </fieldset>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-3">
          {problem ? (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          ) : null}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t("breakdown")}</summary>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
              <dt>{t("totals.taxable")}</dt>
              <dd className="text-right">{formatINR(totals.taxablePaise)}</dd>
              {totals.cgstPaise > 0n ? (
                <>
                  <dt>{t("totals.cgst")}</dt>
                  <dd className="text-right">{formatINR(totals.cgstPaise)}</dd>
                </>
              ) : null}
              {totals.sgstPaise > 0n ? (
                <>
                  <dt>{t("totals.sgst")}</dt>
                  <dd className="text-right">{formatINR(totals.sgstPaise)}</dd>
                </>
              ) : null}
              {totals.utgstPaise > 0n ? (
                <>
                  <dt>{t("totals.utgst")}</dt>
                  <dd className="text-right">{formatINR(totals.utgstPaise)}</dd>
                </>
              ) : null}
              {totals.igstPaise > 0n ? (
                <>
                  <dt>{t("totals.igst")}</dt>
                  <dd className="text-right">{formatINR(totals.igstPaise)}</dd>
                </>
              ) : null}
              {totals.roundOffPaise !== 0n ? (
                <>
                  <dt>{t("totals.roundOff")}</dt>
                  <dd className="text-right">{formatINR(totals.roundOffPaise)}</dd>
                </>
              ) : null}
            </dl>
          </details>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                {t(`saveStatus.${autosave.status}`)}
              </span>
              <span aria-live="polite" className="text-lg font-semibold" data-testid="grand-total">
                {t("grandTotal", { amount: formatINR(totals.grandTotalPaise) })}
              </span>
            </div>
            <Button
              type="button"
              size="lg"
              disabled={locked || issuing}
              onClick={() => void issue()}
            >
              {issuing ? t("issuing") : t("issue")}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={warnings.length > 0}
        onOpenChange={(open) => {
          if (!open) setWarnings([]);
        }}
      >
        <DialogContent>
          <DialogTitle>{t("warningsTitle")}</DialogTitle>
          {warnings.map((warning) => (
            <DialogDescription key={warning}>{t(`warnings.${warning}`)}</DialogDescription>
          ))}
          <CheckboxField
            label={t("acknowledge")}
            checked={acknowledged}
            onChange={(event) => {
              setAcknowledged(event.target.checked);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              disabled={!acknowledged || issuing}
              onClick={() => void issue(warnings)}
            >
              {t("issueAnyway")}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => {
                setWarnings([]);
              }}
            >
              {t("goBack")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={issued !== null}>
        <DialogContent
          onEscapeKeyDown={(event) => {
            event.preventDefault();
          }}
        >
          <DialogTitle>{t("issuedTitle", { number: issued?.number ?? "" })}</DialogTitle>
          <DialogDescription>
            {t("issuedTotal", { amount: formatINR(BigInt(issued?.grandTotalPaise ?? "0")) })}
          </DialogDescription>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href={`/b/${businessSlug}/invoices/${issued?.id ?? ""}`}>
                {t("viewInvoice")}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={`/b/${businessSlug}/invoices/new`}>{t("newInvoice")}</a>
            </Button>
          </div>
          {issued ? (
            <Button asChild size="lg" variant="outline">
              <Link href={`/b/${businessSlug}/payments/new?invoice=${issued.id}`}>
                {t("recordPayment")}
              </Link>
            </Button>
          ) : null}
          {issued ? <PdfActions href={`/b/${businessSlug}/invoices/${issued.id}/pdf`} /> : null}
          {issued?.publicUrl && issued.share ? (
            <WhatsAppShare share={issued.share} url={issued.publicUrl} />
          ) : null}
          {issued?.publicUrl ? <CopyLink url={issued.publicUrl} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogTitle>{t("deleteDraftTitle")}</DialogTitle>
          <DialogDescription>{t("deleteDraftHint")}</DialogDescription>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              variant="destructive"
              onClick={() => void removeDraft()}
            >
              {t("deleteDraft")}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => {
                setConfirmDelete(false);
              }}
            >
              {t("goBack")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
