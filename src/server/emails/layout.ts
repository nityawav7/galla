import { html, type HtmlPart, safeHref, type SafeHtml } from "./html";

/*
 * The frame every business email shares: one centred column, tables and inline styles only,
 * because that is what email clients (Gmail, Outlook, phone apps) render reliably.
 */

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const TEXT = `${FONT}color:#111827;font-size:15px;line-height:1.5;`;
const MUTED = `${FONT}color:#6b7280;font-size:13px;line-height:1.5;`;

export interface EmailDocument {
  /** "en" or "hi", so screen readers and Gmail's translation pick the right language. */
  lang: string;
  /** The subject, repeated as the page title. */
  title: string;
  /** The short line phone apps show next to the subject. */
  preheader: string;
  body: HtmlPart;
  footer: HtmlPart;
}

export function emailDocument(doc: EmailDocument): string {
  return html`<!doctype html>
    <html lang="${doc.lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${doc.title}</title>
      </head>
      <body style="margin:0;padding:0;background:#f3f4f6;">
        <div style="display:none;max-height:0;overflow:hidden;">${doc.preheader}</div>
        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          style="background:#f3f4f6;"
        >
          <tr>
            <td align="center" style="padding:24px 12px;">
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                style="max-width:560px;background:#ffffff;border-radius:12px;"
              >
                <tr>
                  <td style="padding:24px;${TEXT}">${doc.body}</td>
                </tr>
              </table>
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                style="max-width:560px;"
              >
                <tr>
                  <td style="padding:16px 24px;${MUTED}">${doc.footer}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>`.value;
}

export function paragraph(content: HtmlPart): SafeHtml {
  return html`<p style="margin:0 0 16px;${TEXT}">${content}</p>`;
}

export function muted(content: HtmlPart): SafeHtml {
  return html`<p style="margin:0 0 8px;${MUTED}">${content}</p>`;
}

/** Label and value rows, e.g. "Amount due · ₹1,180.00". */
export function facts(rows: readonly (readonly [string, string])[]): SafeHtml {
  return html`<table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    style="margin:0 0 20px;border-collapse:collapse;"
  >
    ${rows.map(
      ([label, value]) =>
        html`<tr>
          <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;${MUTED}">${label}</td>
          <td
            align="right"
            style="padding:6px 0;border-bottom:1px solid #e5e7eb;${TEXT}font-weight:bold;"
          >
            ${value}
          </td>
        </tr>`,
    )}
  </table>`;
}

/** A big tappable link that looks like a button. */
export function button(href: string, label: string): SafeHtml {
  return html`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
    <tr>
      <td style="background:#0f766e;border-radius:8px;">
        <a
          href="${safeHref(href)}"
          style="display:inline-block;padding:12px 20px;${FONT}font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;"
          >${label}</a
        >
      </td>
    </tr>
  </table>`;
}

/** The same link written out, for clients that hide buttons. */
export function plainLink(href: string): SafeHtml {
  return html`<a href="${safeHref(href)}" style="color:#0f766e;word-break:break-all;">${href}</a>`;
}
