import { z } from "zod";
import prisma from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { runAsTenant } from "@/lib/tenant/context";
import { isEmailChannel, providedConnection } from "./provided";

/**
 * The recipients a tenant names for an email channel another tenant shares with it. The mail goes
 * through the server and from the sender of the tenant that shares it, to the addresses the
 * customer keeps here, which hold for every job and template of the customer that names the channel.
 */

/** The most recipients a tenant names for one channel. */
export const MAX_RECIPIENTS = 20;

const RecipientsSchema = z.array(z.string().trim().email("Enter a valid email address")).max(MAX_RECIPIENTS, `Name at most ${MAX_RECIPIENTS} recipients`);

function parse(json: string): string[] {
    try {
        const value: unknown = JSON.parse(json);
        return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
}

/** The recipients a tenant named for a channel, none while it named none. */
export async function recipientsOf(configId: string, tenantId: string): Promise<string[]> {
    const row = await runAsTenant(tenantId, () => prisma.channelRecipients.findUnique({ where: { tenantId_configId: { tenantId, configId } }, select: { recipients: true } }));
    return row ? parse(row.recipients) : [];
}

/** Saves the recipients of a tenant for an email channel another tenant shares with it and lets it name them. */
export async function setRecipients(configId: string, tenantId: string, recipients: string[]): Promise<{ name: string; before: string[]; after: string[] }> {
    const provided = await providedConnection(configId, tenantId);
    if (!provided || provided.type !== "notification") throw new NotFoundError("Channel", configId);
    if (!isEmailChannel(provided.adapterId) || !provided.ownRecipients) {
        throw new ValidationError(`${provided.providerName} decides who gets the messages of this channel.`);
    }
    const parsed = RecipientsSchema.safeParse(recipients);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid recipients");
    const after = [...new Set(parsed.data.map((address) => address.toLowerCase()))];
    const before = await recipientsOf(configId, tenantId);
    await runAsTenant(tenantId, async () => {
        if (after.length === 0) {
            await prisma.channelRecipients.deleteMany({ where: { configId } });
            return;
        }
        await prisma.channelRecipients.upsert({
            where: { tenantId_configId: { tenantId, configId } },
            create: { configId, tenantId, recipients: JSON.stringify(after) },
            update: { recipients: JSON.stringify(after) },
        });
    });
    return { name: provided.name, before, after };
}

/** Where a send through a channel goes for a tenant, or why it goes nowhere. */
export type ChannelTarget = { to?: string[]; refusal?: undefined } | { refusal: string; to?: undefined };

/**
 * Where a message of `tenantId` through a channel goes. A channel of its own sends as it is set. A
 * channel another tenant shares sends to the recipients the tenant named when it may name them,
 * and else to the recipients of the tenant that shares it. It sends nothing once it is no longer
 * shared with the tenant, or while the tenant named nobody, so a message of a customer never
 * reaches the recipients of the tenant that shares it by mistake.
 */
export async function channelTarget(channel: { id: string; tenantId?: string }, tenantId: string | null | undefined): Promise<ChannelTarget> {
    if (!tenantId || !channel.tenantId || channel.tenantId === tenantId) return {};
    const provided = await providedConnection(channel.id, tenantId);
    if (!provided) return { refusal: "This channel is no longer shared with this tenant" };
    if (!provided.ownRecipients) return {};
    const to = await recipientsOf(channel.id, tenantId);
    return to.length > 0 ? { to } : { refusal: "No recipients are named for this channel yet. Add them under Connections, Channels" };
}
