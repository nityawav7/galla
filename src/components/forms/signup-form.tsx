"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth-errors";
import { type SignUpInput, signUpSchema } from "@/lib/validation/auth";

import { GoogleButton } from "./google-button";
import { TextField } from "./text-field";
import { useFormMessages } from "./use-form-messages";
import { useNextPath } from "./use-next-path";

export function SignupForm({ googleEnabled }: { googleEnabled: boolean }) {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const { fieldError, formError } = useFormMessages();
  const router = useRouter();
  const next = useNextPath();
  const [error, setError] = useState<AuthErrorKey>();
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(undefined);
    const { error: signUpError } = await authClient.signUp.email(values);
    if (signUpError) {
      setError(authErrorKey(signUpError));
      return;
    }
    router.push(next);
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive" aria-live="polite">
            <AlertDescription>{formError(error)}</AlertDescription>
          </Alert>
        ) : null}
        <TextField
          label={t("fields.name")}
          autoComplete="name"
          error={fieldError(errors.name)}
          {...form.register("name")}
        />
        <TextField
          label={t("fields.email")}
          type="email"
          inputMode="email"
          autoComplete="email"
          error={fieldError(errors.email)}
          {...form.register("email")}
        />
        <TextField
          label={t("fields.password")}
          type="password"
          autoComplete="new-password"
          hint={t("signup.passwordHint")}
          error={fieldError(errors.password)}
          {...form.register("password")}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? common("pleaseWait") : t("signup.submit")}
        </Button>
      </form>
      {googleEnabled ? <GoogleButton /> : null}
    </div>
  );
}
