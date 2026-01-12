import { NotificationAdapter } from "@/lib/core/interfaces";
import { DiscordSchema } from "@/lib/adapters/definitions";
import { formatBytes } from "@/lib/utils";

export const DiscordAdapter: NotificationAdapter = {
    id: "discord",
    type: "notification",
    name: "Discord Webhook",
    configSchema: DiscordSchema,

    async test(config: any): Promise<{ success: boolean; message: string }> {
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
        } catch (error: any) {
            return { success: false, message: error.message || "Failed to connect to Discord" };
        }
    },

    async send(config: any, message: string, context?: any): Promise<boolean> {
        try {
            const payload: any = {
                content: message,
                username: config.username,
                avatar_url: config.avatarUrl,
            };

            // If we have context (like a backup result), we can add an embed
            if (context) {
                const color = context.success ? 0x00ff00 : 0xff0000; // Green or Red
                const embed: any = {
                    title: context.success ? "Backup Successful" : "Backup Failed",
                    color: color,
                    timestamp: new Date().toISOString(),
                    fields: [
                        { name: "Adapter", value: context.adapterName || "Unknown", inline: true },
                        { name: "Duration", value: context.duration ? `${context.duration}ms` : "N/A", inline: true },
                    ]
                };

                if (context.size !== undefined) {
                    embed.fields.push({ name: "Size", value: formatBytes(context.size), inline: true });
                }

                if (context.error) {
                    embed.description = `**Error:** ${context.error}`;
                }

                payload.embeds = [embed];
                // If we use embeds, we might want to put the main message in the embed or keep it as content.
                // Let's keep content for mentions if needed, but if message is generic, maybe rely on embed.
            }

            const response = await fetch(config.webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                console.error(`Discord notification failed: ${response.status} ${response.statusText}`);
                return false;
            }

            return true;
        } catch (error) {
            console.error("Discord notification error:", error);
            return false;
        }
    }
}
