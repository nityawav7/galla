"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth-errors";
import {
  type CodeSignInInput,
  codeSignInSchema,
  type EmailOnlyInput,
  emailOnlySchema,
  type PasswordSignInInput,
  passwordSignInSchema,
} from "@/lib/validation/auth";

import { GoogleButton } from "./google-button";
import { TextField } from "./text-field";
import { useFormMessages } from "./use-form-messages";

const AFTER_SIGN_IN = "/b";

function FormError({ error }: { error: AuthErrorKey | undefined }) {
  const { formError } = useFormMessages();
  if (!error) return null;
  return (
    <Alert variant="destructive" aria-live="polite">
      <AlertDescription>{formError(error)}</AlertDescription>
    </Alert>
  );
}

function PasswordSignIn() {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const { fieldError } = useFormMessages();
  const router = useRouter();
  const [error, setError] = useState<AuthErrorKey>();
  const form = useForm<PasswordSignInInput>({
    resolver: zodResolver(passwordSignInSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(undefined);
    const { error: signInError } = await authClient.signIn.email(values);
    if (signInError) {
      setError(authErrorKey(signInError));
      return;
    }
    router.push(AFTER_SIGN_IN);
    router.refresh();
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
      <FormError error={error} />
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
        autoComplete="current-password"
        error={fieldError(errors.password)}
        {...form.register("password")}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? common("pleaseWait") : t("login.submit")}
      </Button>
      <Link href="/forgot-password" className="text-sm underline-offset-4 hover:underline">
        {t("login.forgot")}
      </Link>
    </form>
  );
}

function CodeSignIn() {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const { fieldError } = useFormMessages();
  const router = useRouter();
  const [error, setError] = useState<AuthErrorKey>();
  const [sentTo, setSentTo] = useState<string>();

  const emailForm = useForm<EmailOnlyInput>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: "" },
  });
  const codeForm = useForm<CodeSignInInput>({
    resolver: zodResolver(codeSignInSchema),
    defaultValues: { email: "", otp: "" },
  });

  const sendCode = emailForm.handleSubmit(async ({ email }) => {
    setError(undefined);
    const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });
    if (sendError) {
      setError(authErrorKey(sendError));
      return;
    }
    codeForm.reset({ email, otp: "" });
    setSentTo(email);
  });

  const verifyCode = codeForm.handleSubmit(async (values) => {
    setError(undefined);
    const { error: verifyError } = await authClient.signIn.emailOtp(values);
    if (verifyError) {
      setError(authErrorKey(verifyError));
      return;
    }
    router.push(AFTER_SIGN_IN);
    router.refresh();
  });

  if (!sentTo) {
    return (
      <form onSubmit={(event) => void sendCode(event)} noValidate className="flex flex-col gap-4">
        <FormError error={error} />
        <TextField
          label={t("fields.email")}
          type="email"
          inputMode="email"
          autoComplete="email"
          error={fieldError(emailForm.formState.errors.email)}
          {...emailForm.register("email")}
        />
        <Button type="submit" disabled={emailForm.formState.isSubmitting}>
          {emailForm.formState.isSubmitting ? common("pleaseWait") : t("login.sendCode")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={(event) => void verifyCode(event)} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("login.codeSent")}
      </p>
      <FormError error={error} />
      <TextField
        label={t("fields.code")}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        error={fieldError(codeForm.formState.errors.otp)}
        {...codeForm.register("otp")}
      />
      <Button type="submit" disabled={codeForm.formState.isSubmitting}>
        {codeForm.formState.isSubmitting ? common("pleaseWait") : t("login.verifyCode")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setSentTo(undefined);
          setError(undefined);
        }}
      >
        {t("login.differentEmail")}
      </Button>
    </form>
  );
}

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const t = useTranslations("auth.login");
  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue="password">
        <TabsList className="w-full">
          <TabsTrigger value="password">{t("withPassword")}</TabsTrigger>
          <TabsTrigger value="code">{t("withCode")}</TabsTrigger>
        </TabsList>
        <TabsContent value="password" className="pt-4">
          <PasswordSignIn />
        </TabsContent>
        <TabsContent value="code" className="pt-4">
          <CodeSignIn />
        </TabsContent>
      </Tabs>
      {googleEnabled ? <GoogleButton /> : null}
    </div>
  );
}
