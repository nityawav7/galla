"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { acceptInviteAction, declineInviteAction } from "@/app/(auth)/invite/[token]/actions";
import { TextField } from "@/components/forms/text-field";
import { useFormMessages } from "@/components/forms/use-form-messages";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { authErrorKey } from "@/lib/auth-errors";
import { isMemberErrorKey } from "@/lib/validation/members";

const codeSchema = z.object({
  otp: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, { error: "codeFormat" }),
});

/** Accepting an invite needs a verified email (ADR 0004): send a code, then check it. */
export function VerifyEmailForInvite({ email }: { email: string }) {
  const t = useTranslations();
  const { fieldError, formError } = useFormMessages();
  const router = useRouter();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const form = useForm<z.input<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { otp: "" },
  });

  async function sendCode() {
    setError(undefined);
    const result = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });
    if (result.error) setError(formError(authErrorKey(result.error)));
    else setSent(true);
  }

  const verify = form.handleSubmit(async ({ otp }) => {
    setError(undefined);
    const result = await authClient.emailOtp.verifyEmail({ email, otp });
    if (result.error) {
      setError(formError(authErrorKey(result.error)));
      return;
    }
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("invite.verifyTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("invite.verifyBody", { email })}</p>
      {error ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {sent ? (
        <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void verify(event)}>
          <p className="text-sm" aria-live="polite">
            {t("invite.codeSent")}
          </p>
          <TextField
            label={t("auth.fields.code")}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={fieldError(form.formState.errors.otp)}
            {...form.register("otp")}
          />
          <div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t("invite.verify")}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button type="button" onClick={() => void sendCode()}>
            {t("invite.sendCode")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function InviteDecision({ token }: { token: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string>();

  const errorMessage = (message: string) =>
    isMemberErrorKey(message) ? t(`members.errors.${message}`) : t("errors.generic");

  if (declined) return <p aria-live="polite">{t("invite.declined")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void acceptInviteAction(token).then((result) => {
              if (result.ok) {
                router.push(`/b/${result.data.slug}/dashboard`);
                return;
              }
              setPending(false);
              setError(
                result.error.code === "NOT_FOUND"
                  ? t("members.errors.inviteInvalid")
                  : errorMessage(result.error.message),
              );
            });
          }}
        >
          {t("invite.accept")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void declineInviteAction(token).then((result) => {
              setPending(false);
              if (result.ok) setDeclined(true);
              else setError(t("members.errors.inviteInvalid"));
            });
          }}
        >
          {t("invite.decline")}
        </Button>
      </div>
    </div>
  );
}
