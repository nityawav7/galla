"use client";

import { useSearchParams } from "next/navigation";

import { safeNextPath } from "@/lib/safe-redirect";

/** Where to go after signing in or up: the page's `?next=`, if it is on this site. */
export function useNextPath(): string {
  return safeNextPath(useSearchParams().get("next"));
}
