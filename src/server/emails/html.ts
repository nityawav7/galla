/*
 * A tiny HTML builder for emails (SPEC F9, decision 2 of the Phase 10 plan). Everything put into
 * an `html` template is escaped unless it is itself `SafeHtml`, so names typed by shops and
 * customers can never become markup. React's `react-dom/server` would do the same, but Next.js
 * refuses it inside server actions and route handlers (the React Server Components build), so
 * emails are built from strings instead. No dependency either way.
 */

/** Markup that is already escaped. Only `html` and `raw` make one. */
export class SafeHtml {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

export type HtmlPart = SafeHtml | string | number | null | undefined | false | readonly HtmlPart[];

/** Escapes the five characters that matter in text and in quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);
}

function render(part: HtmlPart): string {
  if (part === null || part === undefined || part === false) return "";
  if (part instanceof SafeHtml) return part.value;
  if (Array.isArray(part)) return part.map(render).join("");
  return escapeHtml(String(part));
}

/** Escapes every interpolated value; `SafeHtml` values and lists of them go in as they are. */
export function html(strings: TemplateStringsArray, ...parts: readonly HtmlPart[]): SafeHtml {
  let out = strings[0] ?? "";
  parts.forEach((part, index) => {
    out += render(part) + (strings[index + 1] ?? "");
  });
  return new SafeHtml(out);
}

/** Trusted markup written in code (never user input). */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

/** Only http(s) links go into an href; anything else (javascript:, data:) becomes "#". */
export function safeHref(url: string): string {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : "#";
  } catch {
    return "#";
  }
}
