"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ChangeEvent, type ReactNode, useId, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { type ActionResult } from "@/lib/action-result";
import {
  type ImportReport,
  type ImportResult,
  importSize,
  MAX_IMPORT_BYTES,
} from "@/lib/validation/csv-import";
import { toCsv } from "@/server/domain/csv";

interface CsvImportProps<S> {
  templateRows: readonly (readonly string[])[];
  templateFileName: string;
  preview: (csvText: string) => Promise<ActionResult<ImportReport<S>>>;
  commit: (csvText: string) => Promise<ActionResult<ImportResult<S>>>;
  renderSample: (rows: S[]) => ReactNode;
  importedMessage: (count: number) => string;
  conflictMessage: string;
  doneHref: string;
  doneLabel: string;
}

type State<S> =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "checked"; text: string; report: ImportReport<S> }
  | { step: "importing"; text: string; report: ImportReport<S> }
  | { step: "done"; count: number }
  | { step: "failed"; message: string };

/** Excel only reads a CSV as UTF-8 (₹, Hindi) when it starts with a byte order mark. */
function templateHref(rows: readonly (readonly string[])[]): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${toCsv(rows)}`)}`;
}

const tooLarge = <S,>(): ImportReport<S> => ({
  total: 0,
  valid: 0,
  issueCount: 1,
  issues: [{ line: null, column: null, key: "csvTooLarge" }],
  sample: [],
});

/**
 * Upload → preview → import (ADR 0005). The server checks the file twice: once for the
 * preview, and again when importing, so nothing here is trusted.
 */
export function CsvImport<S>({
  templateRows,
  templateFileName,
  preview,
  commit,
  renderSample,
  importedMessage,
  conflictMessage,
  doneHref,
  doneLabel,
}: CsvImportProps<S>) {
  const t = useTranslations("import");
  const validation = useTranslations("validation");
  const errors = useTranslations("errors");
  const router = useRouter();
  const inputId = useId();
  const [state, setState] = useState<State<S>>({ step: "idle" });

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Let the same file be chosen again after fixing it.
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setState({ step: "checked", text: "", report: tooLarge<S>() });
      return;
    }
    setState({ step: "checking" });
    const text = await file.text();
    if (importSize(text) > MAX_IMPORT_BYTES) {
      setState({ step: "checked", text: "", report: tooLarge<S>() });
      return;
    }
    const result = await preview(text);
    setState(
      result.ok
        ? { step: "checked", text, report: result.data }
        : { step: "failed", message: errors("generic") },
    );
  };

  const importAll = async (text: string, report: ImportReport<S>) => {
    setState({ step: "importing", text, report });
    const result = await commit(text);
    if (!result.ok) {
      setState({
        step: "failed",
        message: result.error.code === "CONFLICT" ? conflictMessage : errors("generic"),
      });
      return;
    }
    if (result.data.status === "invalid") {
      setState({ step: "checked", text, report: result.data.report });
      return;
    }
    setState({ step: "done", count: result.data.count });
    router.refresh();
  };

  const report = state.step === "checked" || state.step === "importing" ? state.report : null;
  const ready = report !== null && report.issueCount === 0 && report.valid > 0;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <div>
        <Button asChild variant="outline">
          <a href={templateHref(templateRows)} download={templateFileName}>
            {t("template")}
          </a>
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>{t("file")}</Label>
        <input
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          aria-describedby={`${inputId}-hint`}
          disabled={state.step === "checking" || state.step === "importing"}
          className="w-full text-sm file:mr-3 file:h-9 file:rounded-lg file:border file:border-input file:bg-background file:px-3 file:text-sm file:font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          onChange={(event) => void choose(event)}
        />
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          {t("fileHint")}
        </p>
      </div>

      <div aria-live="polite" className="flex flex-col gap-4">
        {state.step === "checking" ? <p className="text-sm">{t("checking")}</p> : null}
        {state.step === "failed" ? (
          <Alert variant="destructive">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {state.step === "done" ? (
          <Alert>
            <AlertDescription className="flex flex-col gap-2">
              <span>{importedMessage(state.count)}</span>
              <Link href={doneHref} className="font-medium underline underline-offset-4">
                {doneLabel}
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}
        {report ? (
          <>
            {report.total > 0 ? (
              <p className="text-sm font-medium">
                {t("summary", { valid: report.valid, total: report.total })}
              </p>
            ) : null}
            {report.issueCount > 0 ? (
              <section className="flex flex-col gap-2" aria-labelledby={`${inputId}-issues`}>
                <h2 id={`${inputId}-issues`} className="text-base font-semibold text-destructive">
                  {t("issuesTitle")}
                </h2>
                <ul className="flex flex-col gap-1 text-sm">
                  {report.issues.map((issue, index) => (
                    <li key={`${String(issue.line)}-${issue.column ?? ""}-${String(index)}`}>
                      <span className="font-medium">
                        {issue.line === null ? t("fileProblem") : t("line", { line: issue.line })}
                        {issue.column ? (
                          <>
                            {" · "}
                            <code className="rounded bg-muted px-1">{issue.column}</code>
                          </>
                        ) : null}
                        {": "}
                      </span>
                      {validation(issue.key)}
                    </li>
                  ))}
                </ul>
                {report.issueCount > report.issues.length ? (
                  <p className="text-sm text-muted-foreground">
                    {t("moreIssues", { count: report.issueCount - report.issues.length })}
                  </p>
                ) : null}
              </section>
            ) : null}
            {report.sample.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h2 className="text-base font-semibold">{t("previewTitle")}</h2>
                {renderSample(report.sample)}
              </section>
            ) : null}
            {ready && state.step !== "done" ? (
              <div>
                <Button
                  type="button"
                  size="lg"
                  disabled={state.step === "importing"}
                  onClick={() => {
                    if (state.step === "checked") void importAll(state.text, state.report);
                  }}
                >
                  {state.step === "importing"
                    ? t("importing")
                    : t("commit", { count: report.valid })}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
