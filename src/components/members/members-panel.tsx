"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  cancelInvitationAction,
  inviteMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
} from "@/app/(app)/b/[businessSlug]/members/actions";
import { SelectField } from "@/components/forms/select-field";
import { applyServerErrors } from "@/components/forms/server-errors";
import { TextField } from "@/components/forms/text-field";
import { useFormMessages } from "@/components/forms/use-form-messages";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type ActionResult } from "@/lib/action-result";
import { type InviteFormValues, inviteSchema, isMemberErrorKey } from "@/lib/validation/members";
import { ROLES, type Role } from "@/server/authz/context";

export interface MemberRow {
  memberId: string;
  name: string;
  email: string;
  role: Role;
  isYou: boolean;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  expires: string;
  link: string;
}

interface MembersPanelProps {
  businessSlug: string;
  canManage: boolean;
  members: MemberRow[];
  invitations: InvitationRow[];
}

/** Translates an action's error: a `members.errors` key, or the generic message. */
function useActionError() {
  const t = useTranslations("members.errors");
  const errors = useTranslations("errors");
  return (result: ActionResult<unknown>) =>
    result.ok
      ? undefined
      : isMemberErrorKey(result.error.message)
        ? t(result.error.message)
        : errors("generic");
}

function CopyLink({ link }: { link: string }) {
  const t = useTranslations("members");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(link).then(() => {
          setCopied(true);
        });
      }}
    >
      {copied ? t("copied") : t("copy")}
    </Button>
  );
}

function InviteForm({ businessSlug }: { businessSlug: string }) {
  const t = useTranslations();
  const { fieldError } = useFormMessages();
  const actionError = useActionError();
  const router = useRouter();
  const [link, setLink] = useState<string>();
  const [error, setError] = useState<string>();
  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "STAFF" },
  });

  const submit = form.handleSubmit(async () => {
    setError(undefined);
    setLink(undefined);
    const result = await inviteMemberAction(businessSlug, form.getValues());
    if (result.ok) {
      setLink(result.data.link);
      form.reset({ email: "", role: form.getValues("role") });
      router.refresh();
      return;
    }
    if (applyServerErrors(form, result.error) === undefined) setError(actionError(result));
  });

  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">{t("members.inviteTitle")}</h2>
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        {error ? (
          <Alert variant="destructive" aria-live="polite">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <TextField
          label={t("members.email")}
          type="email"
          inputMode="email"
          autoComplete="off"
          error={fieldError(form.formState.errors.email)}
          {...form.register("email")}
        />
        <SelectField
          label={t("members.role")}
          error={fieldError(form.formState.errors.role)}
          {...form.register("role")}
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`roles.${role}`)}: {t(`roleHints.${role}`)}
            </option>
          ))}
        </SelectField>
        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t("common.pleaseWait") : t("members.sendInvite")}
          </Button>
        </div>
      </form>
      {link ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3" aria-live="polite">
          <p className="text-sm">{t("members.invited")}</p>
          <p className="font-mono text-xs break-all">{link}</p>
          <div>
            <CopyLink link={link} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function MembersPanel({ businessSlug, canManage, members, invitations }: MembersPanelProps) {
  const t = useTranslations();
  const actionError = useActionError();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const roleLabel = (value: string) => {
    const role = ROLES.find((known) => known === value);
    return role ? t(`roles.${role}`) : value;
  };

  async function run(work: () => Promise<ActionResult<null>>, after?: () => void) {
    setBusy(true);
    setError(undefined);
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      setError(actionError(result));
      return;
    }
    if (after) after();
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      {error ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("members.listTitle")}</h2>
        {canManage ? null : (
          <p className="text-sm text-muted-foreground">{t("members.ownerOnly")}</p>
        )}
        <ul className="flex flex-col divide-y rounded-xl border">
          {members.map((member) => (
            <li
              key={member.memberId}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {member.name} {member.isYou ? t("members.you") : null}
                </span>
                <span className="truncate text-sm text-muted-foreground">{member.email}</span>
              </div>
              {canManage ? (
                <div className="flex items-end gap-2">
                  <div className="w-40">
                    <SelectField
                      label={t("members.roleFor", { name: member.name })}
                      className="w-full"
                      value={member.role}
                      disabled={busy}
                      onChange={(event) => {
                        const role = event.target.value;
                        void run(() => updateMemberRoleAction(businessSlug, member.memberId, role));
                      }}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {t(`roles.${role}`)}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(t("members.confirmRemove", { name: member.name })))
                        return;
                      void run(
                        () => removeMemberAction(businessSlug, member.memberId),
                        member.isYou
                          ? () => {
                              router.push("/b");
                            }
                          : undefined,
                      );
                    }}
                  >
                    {t("members.remove")}
                  </Button>
                </div>
              ) : (
                <span className="text-sm">{t(`roles.${member.role}`)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canManage ? (
        <>
          <InviteForm businessSlug={businessSlug} />
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t("members.pendingTitle")}</h2>
            {invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("members.noPending")}</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-xl border">
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{invitation.email}</span>
                      <span className="text-sm text-muted-foreground">
                        {roleLabel(invitation.role)} ·{" "}
                        {t("members.expires", { date: invitation.expires })}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <CopyLink link={invitation.link} />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          void run(() => cancelInvitationAction(businessSlug, invitation.id));
                        }}
                      >
                        {t("members.cancel")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
