import { NotificationAdapter } from "@/lib/core/interfaces";
import { TwilioSmsSchema, TwilioSmsConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "twilio-sms" });

const TWILIO_API = "https://api.twilio.com/2010-04-01";

/**
 * Builds a plain-text SMS message from context.
 * SMS has a 1600 char limit per segment, so keep it concise.
 */
function buildSmsMessage(message: string, context?: any): string {
    const parts: string[] = [];

    if (context?.title) {
        parts.push(context.title);
    }

    // Add status indicator
    if (context?.success === true) {
        parts.push("✅ " + message);
    } else if (context?.success === false) {
        parts.push("❌ " + message);
    } else {
        parts.push(message);
    }

    // Add most important fields only (SMS length limit)
    if (context?.fields?.length) {
        const importantFields = context.fields.slice(0, 4);
        for (const field of importantFields) {
            parts.push(`${field.name}: ${field.value || "-"}`);
        }
    }

    return parts.join("\n");
}

export const TwilioSmsAdapter: NotificationAdapter = {
    id: "twilio-sms",
    type: "notification",
    name: "SMS (Twilio)",
    configSchema: TwilioSmsSchema,

    async test(config: TwilioSmsConfig): Promise<{ success: boolean; message: string }> {
        try {
            const url = `${TWILIO_API}/Accounts/${config.accountSid}/Messages.json`;
            const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

            const body = new URLSearchParams({
                From: config.from,
                To: config.to,
                Body: "🔔 DBackup Connection Test — This is a test SMS to verify your Twilio configuration.",
            });

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": `Basic ${auth}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: body.toString(),
            });

            if (response.ok || response.status === 201) {
                return { success: true, message: "Test SMS sent successfully!" };
            }

            const data = await response.json().catch(() => null);
            const errorMessage = data?.message || response.statusText;
            return { success: false, message: `Twilio returned ${response.status}: ${errorMessage}` };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: message || "Failed to connect to Twilio" };
        }
    },

    async send(config: TwilioSmsConfig, message: string, context?: any): Promise<boolean> {
        try {
            const url = `${TWILIO_API}/Accounts/${config.accountSid}/Messages.json`;
            const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
            const smsBody = buildSmsMessage(message, context);

            const body = new URLSearchParams({
                From: config.from,
                To: config.to,
                Body: smsBody,
            });

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": `Basic ${auth}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: body.toString(),
            });

            if (!response.ok && response.status !== 201) {
                const data = await response.json().catch(() => null);
                log.warn("Twilio SMS failed", {
                    status: response.status,
                    error: data?.message,
                });
                return false;
            }

            return true;
        } catch (error) {
            log.error("Twilio SMS error", {}, wrapError(error));
            return false;
        }
    },
};
