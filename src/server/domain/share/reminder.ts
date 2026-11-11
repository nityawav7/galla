/**
 * The WhatsApp payment reminder (SPEC F7, decision 11 of the Phase 8 plan): what is due, how much
 * of it is overdue, and the oldest open invoices with their links. The wording is fixed text from
 * src/messages in English and Hindi; this only puts the pieces together, so it stays pure.
 */

/** One sentence per part. Placeholders are written `{customer}` and so on. */
export interface ReminderTemplates {
  /** `{customer}` */
  greeting: string;
  /** `{shop}`, `{amount}` */
  due: string;
  /** `{shop}`, `{amount}`, `{overdue}` */
  dueOverdue: string;
  /** `{amount}`: the opening balance still owed */
  opening: string;
  /** `{number}`, `{amount}`, `{dueDate}` */
  line: string;
  /** `{count}`: invoices not listed */
  more: string;
  thanks: string;
}

export interface ReminderInvoice {
  number: string;
  /** What is still due on it, formatted. */
  amount: string;
  dueDate: string;
  /** The public link, or null while it is turned off. */
  link: string | null;
}

export interface ReminderValues {
  customer: string;
  shop: string;
  /** The whole balance due, formatted. */
  amount: string;
  /** Null when nothing is past its due date. */
  overdue: string | null;
  /** Null when no opening balance is owed. */
  opening: string | null;
  invoices: readonly ReminderInvoice[];
  /** Open invoices left out of the list. */
  more: number;
}

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

/** Plain text replacement; braces that aren't one of `values` stay as typed. */
function fill(template: string, values: Record<string, string>): string {
  const known = new Map(Object.entries(values));
  return template.replace(PLACEHOLDER, (whole, name: string) => known.get(name) ?? whole);
}

export function buildReminder(templates: ReminderTemplates, values: ReminderValues): string {
  const { customer, shop, amount, overdue } = values;
  const items: string[] = [];
  if (values.opening !== null) items.push(fill(templates.opening, { amount: values.opening }));
  for (const invoice of values.invoices) {
    items.push(
      fill(templates.line, {
        number: invoice.number,
        amount: invoice.amount,
        dueDate: invoice.dueDate,
      }),
    );
    if (invoice.link !== null) items.push(invoice.link);
  }
  if (values.more > 0) items.push(fill(templates.more, { count: String(values.more) }));

  return [
    fill(templates.greeting, { customer }),
    overdue === null
      ? fill(templates.due, { shop, amount })
      : fill(templates.dueOverdue, { shop, amount, overdue }),
    "",
    ...(items.length > 0 ? [...items, ""] : []),
    templates.thanks,
  ].join("\n");
}
