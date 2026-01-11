import { NotificationAdapter } from "@/lib/core/interfaces";
import { DiscordSchema } from "@/lib/adapters/definitions";

export const DiscordAdapter: NotificationAdapter = {
    id: "discord",
    type: "notification",
    name: "Discord Webhook",
    configSchema: DiscordSchema,

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
                    let sizeStr = "";
                    if (context.size < 1024) {
                        sizeStr = `${context.size} B`;
                    } else if (context.size < 1024 * 1024) {
                        sizeStr = `${(context.size / 1024).toFixed(2)} KB`;
                    } else {
                        sizeStr = `${(context.size / 1024 / 1024).toFixed(2)} MB`;
                    }
                    embed.fields.push({ name: "Size", value: sizeStr, inline: true });
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
