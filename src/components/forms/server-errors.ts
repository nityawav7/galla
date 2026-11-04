import { type FieldValues, type Path, type UseFormReturn } from "react-hook-form";

import { type PublicError } from "@/lib/errors";
import { isValidationKey } from "@/lib/validation/messages";

/**
 * Shows the server's field errors (message keys) on the form. Returns the index of the first
 * step group holding an error field, or undefined when nothing could be placed on a field.
 */
export function applyServerErrors<T extends FieldValues>(
  form: UseFormReturn<T, unknown, unknown>,
  error: PublicError,
  groups: readonly (readonly string[])[] = [],
): number | undefined {
  const fieldIssues = (error.issues ?? []).filter((issue) => isValidationKey(issue.message));
  if (fieldIssues.length === 0) return undefined;
  for (const issue of fieldIssues) {
    form.setError(issue.path as Path<T>, { type: "server", message: issue.message });
  }
  const index = groups.findIndex((group) =>
    fieldIssues.some((issue) => group.includes(issue.path)),
  );
  return index === -1 ? 0 : index;
}
