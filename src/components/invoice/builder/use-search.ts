"use client";

import { useEffect, useState } from "react";

import { type ActionResult } from "@/lib/action-result";

const DEBOUNCE_MS = 250;

/**
 * Runs `search(q)` (a server action) while a panel is open, debounced, keeping only the answer
 * to the latest query so a slow early reply can't replace a newer one.
 */
export function useSearch<T>(
  open: boolean,
  query: string,
  search: (q: string) => Promise<ActionResult<T[]>>,
): { results: T[]; loading: boolean; failed: boolean } {
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void search(query.trim()).then((result) => {
        if (!current) return;
        setLoading(false);
        setFailed(!result.ok);
        setResults(result.ok ? result.data : []);
      });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, query, search]);

  return { results, loading, failed };
}
