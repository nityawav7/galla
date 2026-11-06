"use client";

import { type ComponentProps, useId } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SelectFieldProps extends Omit<ComponentProps<"select">, "id"> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

/** A native select: works with the phone's own picker and needs no extra JavaScript. */
export function SelectField({
  label,
  error,
  hint,
  className,
  children,
  ...props
}: SelectFieldProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={cn(
          "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
