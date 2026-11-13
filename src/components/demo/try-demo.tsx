"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { startDemoAction } from "@/app/(auth)/demo/actions";
import { Button } from "@/components/ui/button";

type Role = "OWNER" | "STAFF";
type Problem = "demoNotReady" | "tooMany" | "failed";
type State =
  { kind: "idle" } | { kind: "starting"; role: Role } | { kind: "failed"; problem: Problem };

/**
 * "Try the demo as Owner / as Staff" (SPEC F12): no sign-up; the server signs the visitor in
 * to the shared demo shop and opens its dashboard.
 */
export function TryDemo() {
  const t = useTranslations("demo");
  const [state, setState] = useState<State>({ kind: "idle" });

  const start = async (role: Role) => {
    setState({ kind: "starting", role });
    const result = await startDemoAction(role);
    // On success the action redirects, so a result means it didn't work.
    if (!result.ok) {
      const problem: Problem =
        result.error.code === "RATE_LIMITED"
          ? "tooMany"
          : result.error.message === "demoNotReady"
            ? "demoNotReady"
            : "failed";
      setState({ kind: "failed", problem });
    }
  };

  const starting = state.kind === "starting";
  return (
    <section aria-labelledby="try-demo" className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 id="try-demo" className="font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" disabled={starting} onClick={() => void start("OWNER")}>
          {starting && state.role === "OWNER" ? t("starting") : t("asOwner")}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={starting}
          onClick={() => void start("STAFF")}
        >
          {starting && state.role === "STAFF" ? t("starting") : t("asStaff")}
        </Button>
      </div>
      <p role="status" className="text-sm text-destructive" data-testid="demo-status">
        {state.kind === "failed" ? t(`errors.${state.problem}`) : ""}
      </p>
    </section>
  );
}
