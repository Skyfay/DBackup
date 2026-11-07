import { NotificationAdapter } from "@/lib/core/interfaces";
import { TelegramSchema, TelegramConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { escapeHtml, escapeTelegramMarkdown } from "./escape";

const log = logger.child({ adapter: "telegram" });

const TELEGRAM_API = "https://api.telegram.org";

type ParseMode = TelegramConfig["parseMode"];

/** How a parse mode marks a word bold and escapes a text, see `escape.ts`. */
const FORMATS: Record<ParseMode, { bold: (text: string) => string; escape: (text: string) => string }> = {
    HTML: { bold: (text) => `<b>${escapeHtml(text)}</b>`, escape: escapeHtml },
    // Legacy Markdown allows no escape inside an entity, so a bold text holds no character it escapes.
    Markdown: {
        bold: (text) => (/[_*`[]/.test(text) ? escapeTelegramMarkdown(text) : `*${text}*`),
        escape: escapeTelegramMarkdown,
    },
};

/**
 * Builds the message for the parse mode it is sent with. Every text is escaped for that mode, so
 * the name of a job or a tenant never becomes a link or markup.
 */
function buildTelegramMessage(message: string, context: any, parseMode: ParseMode = "HTML"): string {
    const format = FORMATS[parseMode] ?? FORMATS.HTML;
    if (!context) return format.escape(message);

    const parts: string[] = [];

    if (context.title) {
        parts.push(format.bold(context.title));
    }

    parts.push(format.escape(message));

    if (context.fields?.length) {
        parts.push("");
        for (const field of context.fields) {
            parts.push(`${format.bold(`${field.name}:`)} ${format.escape(field.value || "-")}`);
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
    credentials: { primary: "TOKEN" },

    async test(config: TelegramConfig): Promise<{ success: boolean; message: string }> {
        try {
            const url = `${TELEGRAM_API}/bot${config.botToken}/sendMessage`;

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: config.chatId,
                    ...(config.messageThreadId ? { message_thread_id: config.messageThreadId } : {}),
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
            const parseMode = config.parseMode || "HTML";
            const formattedMessage = buildTelegramMessage(message, context, parseMode);

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: config.chatId,
                    ...(config.messageThreadId ? { message_thread_id: config.messageThreadId } : {}),
                    text: formattedMessage,
                    parse_mode: parseMode,
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
