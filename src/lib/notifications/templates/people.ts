import { parseUserAgent } from "@/lib/core/user-agent";
import type { NotificationPayload, TemplateOptions, UserCreatedData, UserLoginData } from "../types";
import { action, formatterFor } from "./format";

/** Sign-ins and new accounts, told to the channels or to the person they are about. */

/** "Firefox on macOS", or nothing when the user agent says neither. */
function browserOf(userAgent: string | undefined): string | undefined {
    if (!userAgent) return undefined;
    const { browser, os } = parseUserAgent(userAgent);
    if (browser === "Unknown" && os === "Unknown") return undefined;
    if (os === "Unknown") return browser;
    return browser === "Unknown" ? os : `${browser} on ${os}`;
}

export function userLoginTemplate(data: UserLoginData, options?: TemplateOptions): NotificationPayload {
    const f = formatterFor(options);
    const browser = browserOf(data.userAgent);
    const from = browser ? ` from ${browser}` : "";
    const toUser = options?.audience === "user";
    return {
        title: toUser ? "New sign-in to your account" : `${data.userName} signed in`,
        message: toUser ? `Your account ${data.email} signed in${from}.` : `${data.userName} (${data.email}) signed in${from}.`,
        preheader: `${toUser ? "Your account" : data.userName} signed in${from} at ${f.time(data.timestamp)}.`,
        fields: [
            { name: "User", value: data.userName, inline: true },
            { name: "Email", value: data.email, inline: true },
            ...(data.ipAddress ? [{ name: "IP Address", value: data.ipAddress, inline: true }] : []),
            { name: "Time", value: f.date(data.timestamp) ?? data.timestamp, inline: true },
        ],
        color: "#3b82f6",
        success: true,
        tone: "neutral",
        icon: "log-in",
        stats: [
            { label: "Time", value: f.time(data.timestamp) ?? "" },
            ...(browser ? [{ label: "Browser", value: browser }] : []),
        ],
        details: [
            ...(toUser ? [] : [{ name: "User", value: data.userName }]),
            { name: "Account", value: data.email },
            ...(data.ipAddress ? [{ name: "IP address", value: data.ipAddress }] : []),
            { name: "Time", value: f.date(data.timestamp) ?? data.timestamp },
        ],
        ...(toUser ? { note: "Not you? Change your password under Profile and sign out your other sessions." } : {}),
        actions: toUser ? action("Open sessions", "/dashboard/profile?part=sessions", "user-round") : action("Open users", "/dashboard/users", "users"),
        timestamp: data.timestamp,
    };
}

export function userCreatedTemplate(data: UserCreatedData, options?: TemplateOptions): NotificationPayload {
    const f = formatterFor(options);
    const toUser = options?.audience === "user";
    return {
        title: toUser ? "Your DBackup account is ready" : `${data.userName} has an account now`,
        message: toUser
            ? `${data.createdBy ?? "An admin"} made an account for ${data.email}.`
            : `A new account was made for ${data.userName} (${data.email}).`,
        fields: [
            { name: "User", value: data.userName, inline: true },
            { name: "Email", value: data.email, inline: true },
            ...(data.createdBy ? [{ name: "Created By", value: data.createdBy, inline: true }] : []),
            { name: "Time", value: f.date(data.timestamp) ?? data.timestamp, inline: true },
        ],
        color: "#22c55e",
        success: true,
        tone: "neutral",
        icon: "user-round-plus",
        stats: [],
        details: [
            { name: "Name", value: data.userName },
            { name: "Account", value: data.email },
            ...(data.createdBy ? [{ name: "Made by", value: data.createdBy }] : []),
            { name: "Time", value: f.date(data.timestamp) ?? data.timestamp },
        ],
        actions: toUser ? action("Sign in", "/", "log-in") : action("Open users", "/dashboard/users", "users"),
        timestamp: data.timestamp,
    };
}

/** The mail Test sends from the form of an Email (SMTP) channel. */
export function smtpTestTemplate(server: { host: string; port: number | string; security: string; from: string; to: string }): NotificationPayload {
    return {
        title: "Your SMTP settings work",
        message: `This mail went from DBackup through ${server.host} to ${server.to}.`,
        preheader: "Every notification of this channel looks like this mail.",
        success: true,
        tone: "success",
        icon: "mail",
        stats: [
            { label: "Server", value: server.host },
            { label: "Port", value: String(server.port) },
            { label: "Security", value: server.security },
        ],
        details: [
            { name: "From", value: server.from },
            { name: "To", value: server.to },
        ],
        reason: "You get this because someone pressed Test on an Email (SMTP) channel in DBackup.",
        timestamp: new Date().toISOString(),
    };
}
