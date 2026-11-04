"use server";

import { headers } from "next/headers";

import { type ActionResult } from "@/lib/action-result";
import { runAction } from "@/server/action";
import { requireUser } from "@/server/auth/session";
import { acceptInvite, declineInvite } from "@/server/services/member.service";

export async function acceptInviteAction(token: string): Promise<ActionResult<{ slug: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    return acceptInvite(user.id, await headers(), token);
  });
}

export async function declineInviteAction(token: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requireUser();
    await declineInvite(user.id, await headers(), token);
    return null;
  });
}
