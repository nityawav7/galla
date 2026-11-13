"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { type ActionResult } from "@/lib/action-result";
import { ConflictError, RateLimitError } from "@/lib/errors";
import { clientIp, getLimiter, hashIp } from "@/lib/ratelimit";
import { runAction } from "@/server/action";
import { getAuth } from "@/server/auth/auth";
import { DEMO_BUSINESS } from "@/server/demo/catalog";
import { demoPassword, demoUser } from "@/server/demo/users";

const roleSchema = z.enum(["OWNER", "STAFF"]);

/**
 * "Try the demo" (SPEC F12): signs the visitor in as the demo owner or staff, on the server
 * (the password is derived from the auth secret and never leaves it), then opens the demo
 * dashboard. 10 a hour per IP.
 */
export async function startDemoAction(role: unknown): Promise<ActionResult<never>> {
  return runAction(async () => {
    const parsed = roleSchema.parse(role);
    const incoming = await headers();
    const { success, reset } = await getLimiter("demoSignIn").limit(
      `demo:${hashIp(clientIp(incoming))}`,
    );
    if (!success) throw new RateLimitError(Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
    const user = demoUser(parsed);
    try {
      await getAuth().api.signInEmail({
        body: { email: user.email, password: demoPassword(parsed) },
        headers: incoming,
      });
    } catch (error) {
      // No demo account yet: the daily reset hasn't run since this deploy.
      if (error instanceof APIError) throw new ConflictError("demoNotReady");
      throw error;
    }
    redirect(`/b/${DEMO_BUSINESS.slug}/dashboard`);
  });
}
