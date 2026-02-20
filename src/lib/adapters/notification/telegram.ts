import { NotificationAdapter } from "@/lib/core/interfaces";
import { TelegramSchema, TelegramConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "telegram" });

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Escapes special characters for Telegram HTML parse mode.
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Builds an HTML-formatted message from context for Telegram.
 */
function buildHtmlMessage(message: string, context?: any): string {
    if (!context) return escapeHtml(message);

    const parts: string[] = [];

    if (context.title) {
        parts.push(`<b>${escapeHtml(context.title)}</b>`);
    }

    parts.push(escapeHtml(message));

    if (context.fields?.length) {
        parts.push("");
        for (const field of context.fields) {
            parts.push(`<b>${escapeHtml(field.name)}:</b> ${escapeHtml(field.value || "-")}`);
        }
    }

    // Add status emoji
    if (context.success === true) {
        parts.unshift("✅");
    } else if (context.success === false) {
        parts.unshift("❌");
    }

    return parts.join("\n");
}

export const TelegramAdapter: NotificationAdapter = {
    id: "telegram",
    type: "notification",
    name: "Telegram",
    configSchema: TelegramSchema,

    async test(config: TelegramConfig): Promise<{ success: boolean; message: string }> {
        try {
            const url = `${TELEGRAM_API}/bot${config.botToken}/sendMessage`;

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: config.chatId,
                    text: "🔔 <b>DBackup Connection Test</b>\n\nThis is a test notification to verify your Telegram configuration.",
                    parse_mode: "HTML",
                    disable_notification: true,
                }),
            });

            if (response.ok) {
                return { success: true, message: "Test notification sent successfully!" };
            }

            const body = await response.json().catch(() => null);
            const description = body?.description || response.statusText;
            return { success: false, message: `Telegram returned ${response.status}: ${description}` };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: message || "Failed to connect to Telegram" };
        }
    },

    async send(config: TelegramConfig, message: string, context?: any): Promise<boolean> {
        try {
            const url = `${TELEGRAM_API}/bot${config.botToken}/sendMessage`;
            const formattedMessage = buildHtmlMessage(message, context);

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: config.chatId,
                    text: formattedMessage,
                    parse_mode: config.parseMode || "HTML",
                    disable_notification: config.disableNotification ?? false,
                }),
            });

            if (!response.ok) {
                const body = await response.json().catch(() => null);
                log.warn("Telegram notification failed", {
                    status: response.status,
                    description: body?.description,
                });
                return false;
            }

            return true;
        } catch (error) {
            log.error("Telegram notification error", {}, wrapError(error));
            return false;
        }
    },
};
