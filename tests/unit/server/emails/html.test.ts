import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { escapeHtml, html, raw, SafeHtml, safeHref } from "@/server/emails/html";
import { button, facts, plainLink } from "@/server/emails/layout";

describe("html", () => {
  it("escapes interpolated text, numbers and lists, and drops empty values", () => {
    const name = `<script>alert("x")</script> & 'Co'`;
    const out = html`<p>${name}</p>
      <p>${42}</p>
      ${[html`<b>${"<i>"}</b>`, "a&b"]}${null}${undefined}${false}`;
    expect(out).toBeInstanceOf(SafeHtml);
    // Prettier lays the template out on lines; whitespace between tags doesn't matter here.
    expect(out.value.replace(/>\s+</g, "><")).toBe(
      "<p>&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62; &#38; &#39;Co&#39;</p><p>42</p><b>&#60;i&#62;</b>a&#38;b",
    );
    expect(String(out)).toBe(out.value);
  });

  it("keeps trusted markup as written", () => {
    expect(html`<div>${raw("<br>")}</div>`.value).toBe("<div><br></div>");
  });

  it("never lets user text open a tag or leave an attribute", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const escaped = escapeHtml(text);
        expect(escaped).not.toMatch(/[<>"']/);
        expect(html`<a title="${text}">${text}</a>`.value).toBe(
          `<a title="${escaped}">${escaped}</a>`,
        );
      }),
    );
  });
});

describe("safeHref", () => {
  it.each([
    ["https://galla.test/i/abc", "https://galla.test/i/abc"],
    ["http://localhost:3000/i/abc", "http://localhost:3000/i/abc"],
    ["javascript:alert(1)", "#"],
    ["data:text/html,hi", "#"],
    ["not a url", "#"],
  ])("%s → %s", (url, expected) => {
    expect(safeHref(url)).toBe(expected);
  });
});

describe("layout parts", () => {
  it("escapes labels, values and links", () => {
    expect(facts([["<b>", "₹1 & 2"]]).value).toContain("&#60;b&#62;");
    expect(facts([["<b>", "₹1 & 2"]]).value).toContain("₹1 &#38; 2");
    expect(button("javascript:alert(1)", "Pay").value).toContain('href="#"');
    expect(plainLink("https://x.test/?a=1&b=2").value).toContain(
      'href="https://x.test/?a=1&#38;b=2"',
    );
  });
});
