"use client";

import { type ComponentProps, useId } from "react";

interface CheckboxFieldProps extends Omit<ComponentProps<"input">, "id" | "type"> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

/** A native checkbox with its label to the right, a hint and an error for screen readers. */
export function CheckboxField({ label, hint, error, ...props }: CheckboxFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className="size-5 rounded border-input accent-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          {...props}
        />
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      </div>
      {hint ? (
        <p id={hintId} className="pl-7 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="pl-7 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
