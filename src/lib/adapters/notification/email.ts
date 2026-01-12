import { NotificationAdapter } from "@/lib/core/interfaces";
import { EmailSchema } from "@/lib/adapters/definitions";
import nodemailer from "nodemailer";
import { formatBytes } from "@/lib/utils";

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
        } catch (error: any) {
            return { success: false, message: error.message || "Failed to verify SMTP connection" };
        }
    },

    async send(config: any, message: string, context?: any): Promise<boolean> {
        try {
            const transporter = createTransporter(config);

            // Verify connection configuration
            await transporter.verify();

            let subject = "Database Backup Notification";
            let html = `<p>${message}</p>`;

            if (context) {
                subject = context.success ? "✅ Backup Successful" : "❌ Backup Failed";

                html += `
                    <h3>Details:</h3>
                    <ul>
                        <li><strong>Status:</strong> ${context.success ? "Success" : "Failed"}</li>
                        <li><strong>Adapter:</strong> ${context.adapterName || "Unknown"}</li>
                        <li><strong>Duration:</strong> ${context.duration ? `${context.duration}ms` : "N/A"}</li>
                        ${context.size !== undefined ? `<li><strong>Size:</strong> ${formatBytes(context.size)}</li>` : ''}
                        ${context.error ? `<li><strong>Error:</strong> ${context.error}</li>` : ''}
                    </ul>
                `;
            }

            const info = await transporter.sendMail({
                from: config.from,
                to: config.to,
                subject: subject,
                text: message, // fallback
                html: html,
            });

            console.log("Message sent: %s", info.messageId);
            return true;
        } catch (error) {
            console.error("Email notification error:", error);
            return false;
        }
    }
}
