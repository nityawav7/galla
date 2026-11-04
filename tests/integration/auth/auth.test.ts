import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";
import { accounts, users } from "@/server/db/schema";
import { clearTestOutbox, readTestOutbox } from "@/server/notifications/email";

import { uniqueSlug } from "../support/tenants";

const PASSWORD = "integration-pass-1";

const uniqueEmail = () => `${uniqueSlug("user")}@example.com`;

/** The 6-digit code from the most recent test email to `email`. */
function lastCode(email: string): string {
  const message = readTestOutbox().findLast((sent) => sent.to === email);
  const code = message?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error("no code was emailed");
  return code;
}

async function signUp(email = uniqueEmail()) {
  const result = await getAuth().api.signUpEmail({
    body: { name: "Asha Test", email, password: PASSWORD },
  });
  return { email, user: result.user };
}

describe("Better Auth on our schema (ADR 0004)", () => {
  beforeEach(() => {
    clearTestOutbox();
  });

  it("signs up with a UUIDv7 id, a hashed password and an unverified email", async () => {
    const { email, user } = await signUp();
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const [row] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ email, emailVerified: false });

    const [account] = await getDb().select().from(accounts).where(eq(accounts.userId, user.id));
    expect(account?.providerId).toBe("credential");
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain(PASSWORD);
  });

  it("stores the email in lower case and refuses a second account for it", async () => {
    const email = uniqueEmail();
    await signUp(email.toUpperCase());
    await expect(signUp(email)).rejects.toMatchObject({ statusCode: 422 });
  });

  it("signs in with the password, and rejects a wrong one", async () => {
    const { email } = await signUp();
    const ok = await getAuth().api.signInEmail({ body: { email, password: PASSWORD } });
    expect(ok.token).toBeTruthy();
    await expect(
      getAuth().api.signInEmail({ body: { email, password: "wrong-password" } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("signs in with an emailed code and marks the email verified", async () => {
    const { email, user } = await signUp();
    await getAuth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });

    const session = await getAuth().api.signInEmailOTP({ body: { email, otp: lastCode(email) } });
    expect(session.user.id).toBe(user.id);

    const [row] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(row?.emailVerified).toBe(true);
  });

  it("stores codes hashed, never in plain text", async () => {
    const { email } = await signUp();
    await getAuth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const code = lastCode(email);
    const rows = await getDb().query.verifications.findMany();
    expect(rows.some((row) => row.value.includes(code))).toBe(false);
  });

  it("locks the code after 3 wrong tries", async () => {
    const { email } = await signUp();
    await getAuth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const code = lastCode(email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt <= 3; attempt++) {
      await expect(
        getAuth().api.signInEmailOTP({ body: { email, otp: wrong } }),
      ).rejects.toBeDefined();
    }
    // Even the right code no longer works once the attempts are used up.
    await expect(
      getAuth().api.signInEmailOTP({ body: { email, otp: code } }),
    ).rejects.toBeDefined();
  });

  it("sends no code to an unknown email but answers the same way (no account enumeration)", async () => {
    const email = uniqueEmail();
    const response = await getAuth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    expect(response).toMatchObject({ success: true });
    expect(readTestOutbox().filter((sent) => sent.to === email)).toEqual([]);
    await expect(
      getAuth().api.signInEmailOTP({ body: { email, otp: "123456" } }),
    ).rejects.toBeDefined();
  });

  it("resets the password with an emailed code", async () => {
    const { email } = await signUp();
    await getAuth().api.requestPasswordResetEmailOTP({ body: { email } });
    await getAuth().api.resetPasswordEmailOTP({
      body: { email, otp: lastCode(email), password: "brand-new-pass-2" },
    });

    await expect(
      getAuth().api.signInEmail({ body: { email, password: PASSWORD } }),
    ).rejects.toMatchObject({ statusCode: 401 });
    const ok = await getAuth().api.signInEmail({ body: { email, password: "brand-new-pass-2" } });
    expect(ok.token).toBeTruthy();
  });

  it("does not let anyone create a business through Better Auth", async () => {
    const { email } = await signUp();
    const { headers } = await getAuth().api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = headers.get("set-cookie")?.split(";")[0] ?? "";
    await expect(
      getAuth().api.createOrganization({
        body: { name: "Sneaky Traders", slug: uniqueSlug("sneaky") },
        headers: new Headers({ cookie }),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
