"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth-errors";
import {
  type EmailOnlyInput,
  emailOnlySchema,
  type ResetPasswordInput,
  resetPasswordSchema,
} from "@/lib/validation/auth";

import { TextField } from "./text-field";
import { useFormMessages } from "./use-form-messages";

type Step = "email" | "code" | "done";

export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const { fieldError, formError } = useFormMessages();
  const [step, setStep] = useState<Step>("email");
  const [error, setError] = useState<AuthErrorKey>();

  const emailForm = useForm<EmailOnlyInput>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: "" },
  });
  const resetForm = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: "", otp: "", password: "" },
  });

  const sendCode = emailForm.handleSubmit(async ({ email }) => {
    setError(undefined);
    const { error: sendError } = await authClient.emailOtp.requestPasswordReset({ email });
    if (sendError) {
      setError(authErrorKey(sendError));
      return;
    }
    resetForm.reset({ email, otp: "", password: "" });
    setStep("code");
  });

  const reset = resetForm.handleSubmit(async (values) => {
    setError(undefined);
    const { error: resetError } = await authClient.emailOtp.resetPassword(values);
    if (resetError) {
      setError(authErrorKey(resetError));
      return;
    }
    setStep("done");
  });

  const errorAlert = error ? (
    <Alert variant="destructive" aria-live="polite">
      <AlertDescription>{formError(error)}</AlertDescription>
    </Alert>
  ) : null;

  const backLink = (
    <Link href="/login" className="text-sm underline-offset-4 hover:underline">
      {t("reset.back")}
    </Link>
  );

  if (step === "done") {
    return (
      <div className="flex flex-col gap-4">
        <p aria-live="polite">{t("reset.done")}</p>
        {backLink}
      </div>
    );
  }

  if (step === "email") {
    return (
      <form onSubmit={(event) => void sendCode(event)} noValidate className="flex flex-col gap-4">
        {errorAlert}
        <TextField
          label={t("fields.email")}
          type="email"
          inputMode="email"
          autoComplete="email"
          error={fieldError(emailForm.formState.errors.email)}
          {...emailForm.register("email")}
        />
        <Button type="submit" disabled={emailForm.formState.isSubmitting}>
          {emailForm.formState.isSubmitting ? common("pleaseWait") : t("reset.sendCode")}
        </Button>
        {backLink}
      </form>
    );
  }

  return (
    <form onSubmit={(event) => void reset(event)} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("login.codeSent")}
      </p>
      {errorAlert}
      <TextField
        label={t("fields.code")}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        error={fieldError(resetForm.formState.errors.otp)}
        {...resetForm.register("otp")}
      />
      <TextField
        label={t("fields.newPassword")}
        type="password"
        autoComplete="new-password"
        hint={t("signup.passwordHint")}
        error={fieldError(resetForm.formState.errors.password)}
        {...resetForm.register("password")}
      />
      <Button type="submit" disabled={resetForm.formState.isSubmitting}>
        {resetForm.formState.isSubmitting ? common("pleaseWait") : t("reset.submit")}
      </Button>
      {backLink}
    </form>
  );
}
