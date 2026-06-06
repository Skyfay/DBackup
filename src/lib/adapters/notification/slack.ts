import { NotificationAdapter } from "@/lib/core/interfaces";
import { SlackSchema, SlackConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { validateOutboundUrl } from "@/lib/url-validation";

const log = logger.child({ adapter: "slack" });

export const SlackAdapter: NotificationAdapter = {
    id: "slack",
    type: "notification",
    name: "Slack Webhook",
    configSchema: SlackSchema,
    credentials: { primary: "WEBHOOK" },

    async test(config: SlackConfig): Promise<{ success: boolean; message: string }> {
        try {
            validateOutboundUrl(config.webhookUrl);
            const response = await fetch(config.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: "🔔 *DBackup Connection Test*\nThis is a test notification to verify your webhook configuration.",
                }),
            });

            if (response.ok) {
                return { success: true, message: "Test notification sent successfully!" };
            } else {
                const body = await response.text().catch(() => "");
                return { success: false, message: `Slack returned ${response.status}: ${body || response.statusText}` };
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: message || "Failed to connect to Slack" };
        }
    },

    async send(config: SlackConfig, message: string, context?: any): Promise<boolean> {
        try {
            validateOutboundUrl(config.webhookUrl);
            const payload: Record<string, unknown> = {};

            if (context) {
                const colorHex = context.color
                    ? context.color.replace("#", "")
                    : context.success
                      ? "00ff00"
                      : "ff0000";

                const blocks: Record<string, unknown>[] = [
                    {
                        type: "header",
                        text: {
                            type: "plain_text",
                            text: context.title || "Notification",
                            emoji: true,
                        },
                    },
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: message,
                        },
                    },
                ];

                // Add structured fields as a section with field layout
                if (context.fields?.length) {
                    blocks.push({
                        type: "section",
                        fields: context.fields.map((f: { name: string; value: string }) => ({
                            type: "mrkdwn",
                            text: `*${f.name}:*\n${f.value || "-"}`,
                        })),
                    });
                }

                blocks.push({
                    type: "context",
                    elements: [
                        {
                            type: "mrkdwn",
                            text: `<!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|${new Date().toISOString()}>`,
                        },
                    ],
                });

                // Use attachments for the color bar alongside blocks
                payload.attachments = [
                    {
                        color: `#${colorHex}`,
                        blocks,
                    },
                ];
            } else {
                payload.text = message;
            }

            if (config.channel) {
                payload.channel = config.channel;
            }

            if (config.username) {
                payload.username = config.username;
            }

            if (config.iconEmoji) {
                payload.icon_emoji = config.iconEmoji;
            }

            const response = await fetch(config.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                log.warn("Slack notification failed", { status: response.status, body });
                return false;
            }

            return true;
        } catch (error) {
            log.error("Slack notification error", {}, wrapError(error));
            return false;
        }
    },
};
