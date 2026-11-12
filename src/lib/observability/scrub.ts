/**
 * Strips what Sentry must never receive (ADR 0016, CLAUDE.md rule 9). Shared by the browser,
 * server and edge SDKs, so it imports nothing.
 *
 * - A public invoice link (`/i/{token}`) is a secret: anyone with it sees the invoice.
 * - A business slug (`/b/{slug}`) is made from the shop's name, which can be a person's name.
 * - An invite id (`/invite/{id}`) lets its holder join a business.
 * - Query strings and fragments can carry search text (customer names, phones).
 */

const PATHS: readonly [RegExp, string][] = [
  [/\/i\/[^/?#\s"']+/g, "/i/:token"],
  [/\/b\/[^/?#\s"']+/g, "/b/:slug"],
  [/\/invite\/[^/?#\s"']+/g, "/invite/:id"],
];
/** The query string or fragment of a URL inside some text. */
const URL_QUERY = /(https?:\/\/[^\s?#"']+|\/[^\s?#"']*)[?#][^\s"']*/g;

/** Any text: ids in paths replaced, query strings and fragments of URLs in it dropped. */
export function scrubText(text: string): string {
  let result = text.replace(URL_QUERY, "$1");
  for (const [pattern, replacement] of PATHS) result = result.replace(pattern, replacement);
  return result;
}

function scrubRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "string" ? scrubText(value) : value,
    ]),
  );
}

interface ScrubbableRequest {
  url?: string;
  query_string?: unknown;
  cookies?: unknown;
  headers?: unknown;
  data?: unknown;
  env?: unknown;
}

interface ScrubbableBreadcrumb {
  message?: string;
  data?: Record<string, unknown>;
}

export interface ScrubbableEvent {
  request?: ScrubbableRequest;
  user?: unknown;
  message?: string;
  transaction?: string;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: ScrubbableBreadcrumb[];
  extra?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(breadcrumb: T): T {
  return {
    ...breadcrumb,
    ...(breadcrumb.message === undefined ? {} : { message: scrubText(breadcrumb.message) }),
    ...(breadcrumb.data === undefined ? {} : { data: scrubRecord(breadcrumb.data) }),
  };
}

/**
 * An error or transaction event with no request details (cookies, headers, body, query), no
 * user, and no secrets or names in its URLs, messages, tags or breadcrumbs.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const scrubbed: T = { ...event };
  delete scrubbed.user;
  if (event.request) {
    scrubbed.request = event.request.url === undefined ? {} : { url: scrubText(event.request.url) };
  }
  if (event.message !== undefined) scrubbed.message = scrubText(event.message);
  if (event.transaction !== undefined) scrubbed.transaction = scrubText(event.transaction);
  if (event.exception?.values) {
    scrubbed.exception = {
      ...event.exception,
      values: event.exception.values.map((value) =>
        value.value === undefined ? value : { ...value, value: scrubText(value.value) },
      ),
    };
  }
  if (event.breadcrumbs) scrubbed.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  if (event.tags) scrubbed.tags = scrubRecord(event.tags);
  if (event.extra) scrubbed.extra = scrubRecord(event.extra);
  return scrubbed;
}

interface ScrubbableSpan {
  name: string;
  attributes?: Record<string, unknown>;
}

/** A span (performance trace) with its name and string attributes scrubbed. */
export function scrubSpan<T extends ScrubbableSpan>(span: T): T {
  return {
    ...span,
    name: scrubText(span.name),
    ...(span.attributes === undefined ? {} : { attributes: scrubRecord(span.attributes) }),
  };
}
