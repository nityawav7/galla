"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createDraftAction,
  updateDraftAction,
} from "@/app/(app)/b/[businessSlug]/invoices/actions";
import { type InvoiceDraft } from "@/lib/validation/invoices";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "conflict";

const AUTOSAVE_DELAY_MS = 1500;

interface AutosaveOptions {
  businessSlug: string;
  initialId: string | null;
  initialVersion: number;
  draft: InvoiceDraft;
  /** False once issued (or after a conflict): nothing more is saved. */
  enabled: boolean;
}

/** Nothing worth a database row yet: no customer, no lines, nothing typed. */
function isBlank(draft: InvoiceDraft): boolean {
  return (
    draft.customerId === null &&
    draft.lines.length === 0 &&
    !draft.walkInName.trim() &&
    !draft.notes.trim()
  );
}

/**
 * Autosaves the draft 1.5 s after the last change (SPEC F4). Saves run one at a time, each
 * sending the version it last saw; the server refuses a stale one (another tab). The first
 * save creates the draft and swaps the URL to its edit page without reloading.
 */
export function useAutosave({
  businessSlug,
  initialId,
  initialVersion,
  draft,
  enabled,
}: AutosaveOptions) {
  const json = JSON.stringify(draft);
  const latest = useRef(json);
  const lastSaved = useRef(initialId ? json : JSON.stringify(null));
  const id = useRef(initialId);
  const version = useRef(initialVersion);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const [status, setStatus] = useState<SaveStatus>(initialId ? "saved" : "idle");
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    latest.current = json;
  }, [json]);

  const run = useCallback(async (): Promise<boolean> => {
    const current = latest.current;
    if (current === lastSaved.current) return true;
    const payload = JSON.parse(current) as InvoiceDraft;
    if (!id.current && isBlank(payload)) return true;
    setStatus("saving");
    const result = id.current
      ? await updateDraftAction(businessSlug, id.current, {
          version: version.current,
          draft: payload,
        })
      : await createDraftAction(businessSlug, payload);
    if (!result.ok) {
      if (result.error.code === "CONFLICT") {
        setConflict(result.error.message);
        setStatus("conflict");
      } else {
        setStatus("error");
      }
      return false;
    }
    if (!id.current) {
      id.current = result.data.id;
      window.history.replaceState(null, "", `/b/${businessSlug}/invoices/${result.data.id}/edit`);
    }
    version.current = result.data.version;
    lastSaved.current = current;
    setStatus(latest.current === current ? "saved" : "pending");
    return true;
  }, [businessSlug]);

  /** Saves now (after any save in flight). Resolves false if the save failed. */
  const saveNow = useCallback((): Promise<boolean> => {
    queue.current = queue.current.then(run, run);
    return queue.current;
  }, [run]);

  useEffect(() => {
    if (!enabled || conflict !== null || json === lastSaved.current) return;
    if (!id.current && isBlank(JSON.parse(json) as InvoiceDraft)) return;
    setStatus("pending");
    const timer = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [json, enabled, conflict, saveNow]);

  return {
    status,
    conflict,
    saveNow,
    invoiceId: () => id.current,
    version: () => version.current,
  };
}
