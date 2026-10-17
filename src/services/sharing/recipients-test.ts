import prisma from "@/lib/prisma";
import { registerAdapters } from "@/lib/adapters";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { loadNotificationBrand } from "@/lib/notifications/brand";
import { renderTemplate } from "@/lib/notifications/templates";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";
import { runAsSystem } from "@/lib/tenant/context";
import { sendThroughChannel } from "@/services/notifications/channel-send";
import { buildTestData } from "@/services/notifications/notification-test-data";
import { recipientsOf } from "./channel-recipients";
import { isEmailChannel, providedConnection } from "./provided";

/** How long a tenant waits between two tests of one channel, which sends through the mail server of another tenant. */
export const TEST_COOLDOWN_MS = 60_000;

/** When each tenant last sent a test through a channel, by tenant and channel. */
const lastTests = new Map<string, number>();

/**
 * Sends a test message of a tenant through an email channel another tenant shares with it, to the
 * recipients it named. A plain notification, never the SMTP test of the channel, whose mail names
 * the server and the sender of the tenant that shares it. One a minute, so nobody sends mail in a
 * loop through the server of another tenant.
 */
export async function sendRecipientsTest(configId: string, tenantId: string, now = Date.now()): Promise<{ name: string; recipients: string[] }> {
    const key = `${tenantId}\n${configId}`;
    const last = lastTests.get(key);
    if (last !== undefined && now - last < TEST_COOLDOWN_MS) throw new ValidationError("A test went out a moment ago. Try again in a minute.");
    const provided = await providedConnection(configId, tenantId);
    if (!provided || provided.type !== "notification") throw new NotFoundError("Channel", configId);
    if (!isEmailChannel(provided.adapterId) || !provided.ownRecipients) throw new ValidationError(`${provided.providerName} decides who gets the messages of this channel.`);
    const recipients = await recipientsOf(configId, tenantId);
    if (recipients.length === 0) throw new ValidationError("Name the recipients first.");

    const event = buildTestData(NOTIFICATION_EVENTS.BACKUP_SUCCESS);
    if (!event) throw new ValidationError("There is no test message to send.");
    const channel = await runAsSystem(() => prisma.adapterConfig.findUnique({ where: { id: configId } }));
    if (!channel) throw new NotFoundError("Channel", configId);
    registerAdapters();
    const brand = await loadNotificationBrand();
    const payload = { ...renderTemplate(event, { timeZone: brand.timeZone }), reason: `This is a test of the recipients your tenant named for "${provided.name}".` };
    lastTests.set(key, now);
    await sendThroughChannel(channel, payload, event.eventType, undefined, { brand, tenantId });
    return { name: provided.name, recipients };
}
