"use client";

import { type ComponentProps, useId } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SelectFieldProps extends Omit<ComponentProps<"select">, "id"> {
  label: string;
  error?: string | undefined;
}

/** A native select: works with the phone's own picker and needs no extra JavaScript. */
export function SelectField({ label, error, className, children, ...props }: SelectFieldProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
        className={cn(
          "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
