import { NotificationAdapter } from "@/lib/core/interfaces";
import { DiscordSchema, DiscordConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "discord" });

export const DiscordAdapter: NotificationAdapter = {
    id: "discord",
    type: "notification",
    name: "Discord Webhook",
    configSchema: DiscordSchema,

    async test(config: DiscordConfig): Promise<{ success: boolean; message: string }> {
        try {
            const response = await fetch(config.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: "🔔 **Backup Manager Connection Test**\nThis is a test notification to verify your webhook configuration.",
                    username: config.username || "Backup Manager Test",
                    avatar_url: config.avatarUrl,
                }),
            });

            if (response.ok) {
                return { success: true, message: "Test notification sent successfully!" };
            } else {
                return { success: false, message: `Discord returned ${response.status}: ${response.statusText}` };
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: message || "Failed to connect to Discord" };
        }
    },

    async send(config: DiscordConfig, message: string, context?: any): Promise<boolean> {
        try {
            const payload: any = {
                content: message,
                username: config.username,
                avatar_url: config.avatarUrl,
            };

            if (context) {
                const color = context.color
                    ? parseInt(context.color.replace("#", ""), 16)
                    : context.success
                      ? 0x00ff00
                      : 0xff0000;

                const embed: any = {
                    title: context.title || "Notification",
                    description: message,
                    color,
                    timestamp: new Date().toISOString(),
                    fields: (context.fields || []).map((f: any) => ({
                        name: f.name,
                        value: f.value,
                        inline: f.inline ?? true,
                    })),
                };

                payload.embeds = [embed];
                // Clear content so we don't duplicate the message
                payload.content = undefined;
            }

            const response = await fetch(config.webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                log.warn("Discord notification failed", { status: response.status, statusText: response.statusText });
                return false;
            }

            return true;
        } catch (error) {
            log.error("Discord notification error", {}, wrapError(error));
            return false;
        }
    }
}
