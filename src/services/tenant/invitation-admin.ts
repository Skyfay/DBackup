import { z } from "zod";
import { roleRefusal, type AccountActor } from "@/lib/auth/account-access";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import prisma from "@/lib/prisma";
import { runAsTenant } from "@/lib/tenant/context";
import { auditService } from "@/services/audit-service";
import { INVITATION_MAX_DAYS, invitationService, type InvitationRow } from "@/services/tenant/invitation-service";
import { GROUP_GONE, MemberGoneError } from "@/services/tenant/member-rules";
import { TenantAdminRefusal, tenantOrigin } from "@/services/tenant/tenant-admin";
import { groupService } from "@/services/user/group-service";

/**
 * The links that add someone to a tenant, made by the admin of the tenant on its Users tab and by
 * whoever manages the tenants through `/api/tenants/{id}/invitations`. The caller checked the right
 * and the tenant, and hands in what the maker may do in that tenant, which caps the group.
 */

/** Who makes or takes back a link: a person, or the owner of the API key of the request. */
export interface InvitationMaker {
    id: string;
    /** The name the list of open links shows. Read from the account when left out. */
    name?: string | null;
    /** The API key of the request, which the audit entry names. */
    apiKeyId?: string | null;
}

export const INVITATION_GONE = "The invitation is gone already.";

/** A new link: the group it gives, a note on who it is for, and how many days it works. */
export const InviteSchema = z.object({
    groupId: z.string().min(1).max(200),
    /** Who the link is for, shown in the list of open links. */
    note: z.string().trim().max(100, "The note can have at most 100 characters.").optional(),
    // Left out, the link works for `INVITATION_DAYS`.
    days: z.coerce.number().int().min(1).max(INVITATION_MAX_DAYS).optional(),
});

/** The address of the page that opens a link, relative to the address of DBackup. */
export const invitationPath = (token: string) => `/invite?token=${token}`;

/**
 * Makes a link that adds someone to a tenant with a group. Nobody hands out a group that may do
 * more than they may in that tenant. The token comes back once.
 */
export async function createInvitationAs(maker: InvitationMaker, caps: AccountActor, tenantId: string, input: z.output<typeof InviteSchema>) {
    // A group belongs to its tenant, so it is looked up there.
    const group = await runAsTenant(tenantId, () => groupService.find(input.groupId));
    if (!group) throw new MemberGoneError("Group", GROUP_GONE);
    const refused = roleRefusal(caps, group);
    if (refused) throw new TenantAdminRefusal(refused);

    const name = maker.name !== undefined ? maker.name : (await prisma.user.findUnique({ where: { id: maker.id }, select: { name: true } }))?.name ?? null;
    const invitation = await invitationService.create({ tenantId, groupId: group.id, note: input.note, days: input.days, createdById: maker.id, createdByName: name });
    await auditService.log(maker.id, AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.TENANT, { change: "Invitation created", group: group.name, note: input.note ?? null }, tenantId, tenantOrigin(maker, tenantId));
    return { id: invitation.id, token: invitation.token, path: invitationPath(invitation.token), expiresAt: invitation.expiresAt, group: { id: group.id, name: group.name } };
}

/** The open links of a tenant, newest first. Never a token. */
export async function invitationsOf(tenantId: string): Promise<InvitationRow[]> {
    return invitationService.list(tenantId);
}

/** Takes back a link of a tenant nobody used yet. */
export async function revokeInvitationAs(maker: InvitationMaker, tenantId: string, invitationId: string) {
    const revoked = await invitationService.revoke(invitationId, tenantId);
    await auditService.log(maker.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.TENANT, { change: "Invitation revoked", group: revoked.groupName, note: revoked.note }, tenantId, tenantOrigin(maker, tenantId));
    return revoked;
}
