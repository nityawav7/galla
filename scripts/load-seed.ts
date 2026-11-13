/**
 * Prepares the k6 load test (load/issue-invoice.js, docs/load-test.md): one signed-in user with
 * their own business per virtual user, and the ids of the server actions the test calls.
 *
 *   pnpm build && pnpm start   (another terminal)
 *   pnpm load:seed [users]     writes load/.users.json and load/.actions.json (git-ignored)
 *
 * Local databases only: it refuses Neon, so it can never fill the real database with test shops.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import type * as NextEnv from "@next/env";

const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as typeof NextEnv;
loadEnvConfig(process.cwd());

const { closeDb, driverFor } = await import("../src/server/db/client");
const { env } = await import("../src/lib/env");
const { getAuth } = await import("../src/server/auth/auth");
const { createBusiness } = await import("../src/server/services/business.service");
const { EMPTY_BUSINESS_FORM } = await import("../src/lib/validation/business");

const ACTIONS = ["createDraftAction", "issueInvoiceAction"] as const;

if (driverFor(env.DATABASE_URL) === "neon") {
  throw new Error("Refusing to create load-test users in a Neon database.");
}

const count = Number(process.argv[2] ?? "10");
if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("users: 1 to 50");

// The ids Next gave this build's server actions, by their exported names.
const manifest = JSON.parse(
  readFileSync(".next/server/server-reference-manifest.json", "utf8"),
) as { node: Record<string, { exportedName?: string; filename?: string }> };
const actions = Object.fromEntries(
  ACTIONS.map((name) => {
    const id = Object.entries(manifest.node).find(
      ([, entry]) => entry.exportedName === name && entry.filename?.includes("/invoices/actions"),
    )?.[0];
    if (!id) throw new Error(`${name} is not in this build; run pnpm build first`);
    return [name, id];
  }),
);

const users: { cookie: string; slug: string }[] = [];
try {
  for (let index = 1; index <= count; index += 1) {
    const email = `load-${randomBytes(6).toString("hex")}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const { user } = await getAuth().api.signUpEmail({
      body: { name: `Load Tester ${String(index)}`, email, password },
    });
    const { slug } = await createBusiness(user.id, {
      ...EMPTY_BUSINESS_FORM,
      legalName: `Load Test Shop ${String(index)}`,
      addressLine1: "1 Test Road",
      city: "Pune",
      pincode: "411001",
      stateCode: "27",
      gstScheme: "REGULAR",
      gstin: "27AAPFU0939F1ZV",
    });
    // Signing in on the server side skips the 5-a-minute limit on sign-in requests.
    const response = await getAuth().api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0] ?? "")
      .find((pair) => pair.includes("session_token="));
    if (!cookie) throw new Error("sign-in returned no session cookie");
    users.push({ cookie, slug });
  }
} finally {
  await closeDb();
}

writeFileSync("load/.users.json", JSON.stringify(users));
writeFileSync("load/.actions.json", JSON.stringify(actions));
console.log(
  `Seeded ${String(users.length)} users with a business each; actions: ${ACTIONS.join(", ")}.`,
);
