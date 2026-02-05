import { NotificationAdapter } from "@/lib/core/interfaces";
import { EmailSchema } from "@/lib/adapters/definitions";
import nodemailer from "nodemailer";
// import { formatBytes } from "@/lib/utils";
import React from "react";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "email" });

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

export const EmailAdapter: NotificationAdapter = {
    id: "email",
    type: "notification",
    name: "Email (SMTP)",
    configSchema: EmailSchema,

    async test(config: any): Promise<{ success: boolean; message: string }> {
        try {
            const transporter = createTransporter(config);
            await transporter.verify();
            return { success: true, message: "SMTP connection verified successfully!" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: message || "Failed to verify SMTP connection" };
        }
    },

    async send(config: any, message: string, context?: any): Promise<boolean> {
        try {
            const transporter = createTransporter(config);

            // Verify connection configuration
            await transporter.verify();

            let subject = "Database Backup Notification";

            if (context) {
                subject = context.success ? "✅ Backup Successful" : "❌ Backup Failed";
            }

            // Dynamic import to avoid build errors with server components in some contexts
            const { renderToStaticMarkup } = await import("react-dom/server");
            const { NotificationEmail } = await import("@/components/email/notification-template");

            const html = renderToStaticMarkup(
                <NotificationEmail message={message} context={context} />
            );

            const info = await transporter.sendMail({
                from: config.from,
                to: config.to,
                subject: subject,
                text: message, // fallback
                html: html,
            });

            log.info("Email notification sent", { messageId: info.messageId });
            return true;
        } catch (error) {
            log.error("Email notification failed", {}, wrapError(error));
            return false;
        }
    }
}
