import { NotificationAdapter } from "@/lib/core/interfaces";
import { EmailSchema } from "@/lib/adapters/definitions";
import nodemailer from "nodemailer";
import React from "react";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

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
    credentials: { primary: "SMTP" },

    async test(config: any): Promise<{ success: boolean; message: string }> {
        try {
            const transporter = createTransporter(config);
            await transporter.verify();

            const recipient = Array.isArray(config.to) ? config.to.join(", ") : config.to;

            await transporter.sendMail({
                from: config.from,
                to: recipient,
                subject: "DBackup - Test Email",
                text: "This is a test email sent by DBackup to verify that your SMTP configuration is working correctly.",
                html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="color:#22c55e;margin-bottom:8px">Test Email</h2>
  <p style="color:#374151">This is a test email sent by <strong>DBackup</strong> to verify that your SMTP configuration is working correctly.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="color:#9ca3af;font-size:12px">You can safely ignore this message.</p>
</div>`,
            });

            return { success: true, message: `SMTP connection verified. Test email sent to ${recipient}` };
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

            const subject = context?.title || "DBackup Notification";

            // Dynamic import to avoid build errors with server components in some contexts
            const { renderToStaticMarkup } = await import("react-dom/server");
            const { SystemNotificationEmail } = await import(
                "@/components/email/system-notification-template"
            );

            const html = renderToStaticMarkup(
                <SystemNotificationEmail
                    title={context?.title || "Notification"}
                    message={message}
                    fields={context?.fields}
                    color={context?.color}
                    success={context?.success ?? true}
                    badge={context?.badge}
                />
            );

            const info = await transporter.sendMail({
                from: config.from,
                to: Array.isArray(config.to) ? config.to.join(", ") : config.to,
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
