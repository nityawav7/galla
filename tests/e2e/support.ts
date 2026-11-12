import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test, type TestInfo } from "@playwright/test";

/**
 * The visible input labelled exactly `label`. Tab panels are labelled "Password" too, and
 * Next keeps pages visited earlier mounted but hidden, so their inputs are still in the DOM.
 */
export const field = (page: Page, label: string) =>
  page
    .locator("input, select")
    .and(page.getByLabel(label, { exact: true }))
    .filter({ visible: true });

/**
 * Sign-ups are limited to 5 per minute per IP (SPEC §6.2) and a whole e2e run comes from one
 * IP, so each account-creating test runs in one browser size only. Budget: 4 per run.
 */
export function onlyOn(testInfo: TestInfo, project: "desktop" | "mobile"): void {
  if (testInfo.project.name !== project) testInfo.skip(true, "saves the sign-up rate limit");
}

export async function signUp(
  page: Page,
  name: string,
): Promise<{ email: string; password: string }> {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = `e2e-${randomUUID()}`;
  await page.goto("/signup");
  await field(page, "Your name").fill(name);
  await field(page, "Email").fill(email);
  await field(page, "Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  // The first sign-up of a local run waits for the dev server to compile the next pages.
  await page.waitForURL((url) => !url.pathname.endsWith("/signup"), { timeout: 30_000 });
  return { email, password };
}

/** Fetches a PDF route with the page's session and checks it really is a PDF (SPEC F5). */
export async function expectPdf(page: Page, href: string): Promise<void> {
  const response = await page.request.get(href);
  expect(response.status(), href).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect((await response.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
}

/**
 * Collects Content-Security-Policy violations the browser reports on this page (SPEC §6.2). A
 * test asserts the list is empty at its end: a blocked script would break the page silently.
 */
export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    // Vercel's preview toolbar (vercel.live) is injected into preview deployments without our
    // nonce; it is blocked on purpose (ADR 0015) and isn't part of the app.
    if (
      message.type() === "error" &&
      text.includes("Content Security Policy") &&
      !text.includes("vercel.live")
    ) {
      violations.push(text);
    }
  });
  return violations;
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DESKTOP = { width: 1280, height: 800 };

/**
 * Runs axe on the page at its own size (360 px in the mobile journey) and at desktop width
 * (SPEC §6.1, Phase 11c). Serious and critical violations fail the test (soft, so one run lists
 * them all); moderate and minor ones are attached to the report for the hardening checklist.
 */
export async function expectAccessible(page: Page, name: string): Promise<void> {
  const own = page.viewportSize();
  const sizes = own && own.width < DESKTOP.width ? [own, DESKTOP] : [own ?? DESKTOP];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const where = `${name} at ${String(size.width)} px`;
    const blocking = violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    const other = violations.filter((violation) => !blocking.includes(violation));
    if (other.length > 0) {
      await test.info().attach(`axe: ${where}`, {
        body: JSON.stringify(other.map(summarise), null, 2),
        contentType: "application/json",
      });
    }
    expect
      .soft(blocking.map(summarise), `serious or critical accessibility issues on ${where}`)
      .toEqual([]);
  }
  if (own) await page.setViewportSize(own);
}

function summarise(violation: {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target: unknown }[];
}) {
  return {
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.slice(0, 5).map((node) => JSON.stringify(node.target)),
  };
}
