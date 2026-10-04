import { NotificationAdapter } from "@/lib/core/interfaces";
import { EmailSchema } from "@/lib/adapters/definitions";
import nodemailer from "nodemailer";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { loadNotificationBrand, senderWithName, type NotificationBrand } from "@/lib/notifications/brand";
import { smtpTestTemplate } from "@/lib/notifications/templates";
import type { NotificationPayload } from "@/lib/notifications/types";

const log = logger.child({ adapter: "email" });

const SECURITY_LABELS: Record<string, string> = { ssl: "SSL/TLS", starttls: "STARTTLS", none: "None" };

const createTransporter = (config: any) => {
    const secure = config.secure === "ssl";
    const options: any = {
        host: config.host,
        port: config.port,
        secure: secure,
        auth: (config.user && config.password) ? {
            user: config.user,
            pass: config.password,
        } : undefined,
    };

    if (config.secure === "none") {
        options.ignoreTLS = true;
    }

    return nodemailer.createTransport(options);
};

function recipients(config: any): string {
    return Array.isArray(config.to) ? config.to.join(", ") : config.to;
}

/** The payload a caller hands over, or a plain one around the message for a caller that sends only text. */
function payloadOf(message: string, context: any): NotificationPayload {
    if (context?.title) return { ...context, message: context.message ?? message, success: context.success ?? true };
    return { title: "DBackup notification", message, success: context?.success ?? true };
}

async function mailFor(payload: NotificationPayload, brand: NotificationBrand) {
    // Loaded when a mail goes out, so the React renderer never lands in the graph of a page.
    const { renderNotificationEmail } = await import("@/components/email/render-email");
    return renderNotificationEmail(payload, brand);
}

export const EmailAdapter: NotificationAdapter = {
    id: "email",
    type: "notification",
    name: "Email (SMTP)",
    configSchema: EmailSchema,
    credentials: { primary: "SMTP", primaryOptional: true },

    async test(config: any): Promise<{ success: boolean; message: string }> {
        try {
            const transporter = createTransporter(config);
            await transporter.verify();

            const to = recipients(config);
            const brand = await loadNotificationBrand();
            const mail = await mailFor(
                smtpTestTemplate({ host: config.host, port: config.port, security: SECURITY_LABELS[config.secure] ?? config.secure, from: config.from, to }),
                brand,
            );

            await transporter.sendMail({
                from: senderWithName(config.from, brand),
                to,
                subject: mail.subject,
                text: mail.text,
                html: mail.html,
            });

            return { success: true, message: `SMTP connection verified. Test email sent to ${to}` };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: message || "Failed to send test email" };
        }
    },

    async send(config: any, message: string, context?: any): Promise<boolean> {
        try {
            const transporter = createTransporter(config);

            // Verify connection configuration
            await transporter.verify();

            const brand: NotificationBrand = context?.brand ?? await loadNotificationBrand();
            const mail = await mailFor(payloadOf(message, context), brand);

            const info = await transporter.sendMail({
                from: senderWithName(config.from, brand),
                to: recipients(config),
                subject: mail.subject,
                text: mail.text,
                html: mail.html,
            });

            log.info("Email notification sent", { messageId: info.messageId });
            return true;
        } catch (error) {
            log.error("Email notification failed", {}, wrapError(error));
            return false;
        }
    }
}
