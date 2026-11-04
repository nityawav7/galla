"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

import { useNextPath } from "./use-next-path";

/** Shown only when Google sign-in is configured (GOOGLE_CLIENT_ID and _SECRET). */
export function GoogleButton() {
  const t = useTranslations();
  const [pending, setPending] = useState(false);
  const next = useNextPath();

  return (
    <>
      <p className="text-center text-xs text-muted-foreground">{t("common.or")}</p>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void authClient.signIn.social({ provider: "google", callbackURL: next });
        }}
      >
        {t("auth.login.google")}
      </Button>
    </>
  );
}
