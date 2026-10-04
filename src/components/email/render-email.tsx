import * as React from "react";
import type { NotificationPayload } from "@/lib/notifications/types";
import { DEFAULT_BRAND, type NotificationBrand } from "@/lib/notifications/brand";
import { darkModeCss, LIGHT } from "./email-theme";
import { absoluteHref, detailsOf, NotificationEmail } from "./notification-email";
import { sentence } from "./email-parts";

export interface RenderedEmail {
    subject: string;
    html: string;
    /** The same mail as plain text, for the clients that show no HTML. */
    text: string;
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** On a phone the tiles go two by two and the date leaves the head. */
const PHONE_CSS = "@media (max-width:520px){.m-stat{display:inline-block!important;width:50%!important;box-sizing:border-box;padding:0 0 8px 0!important}.m-stat:nth-child(odd){padding-right:8px!important}.m-wide{display:none!important}.m-pad{padding-left:16px!important;padding-right:16px!important}}";

/**
 * The preheader is the line a mail client shows after the subject. The blank characters after it
 * keep the client from filling the rest of that line with the first words of the mail.
 */
function preheaderHtml(text: string): string {
    const filler = "&#847;&zwnj;&nbsp;".repeat(60);
    return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;opacity:0">${escapeHtml(text)}${filler}</div>`;
}

export function emailText(payload: NotificationPayload, brand: NotificationBrand): string {
    const blocks: string[] = [`${payload.title}\n${payload.message}`];
    if (payload.stats?.length) blocks.push(payload.stats.map((stat) => `${stat.label}: ${stat.value}`).join("\n"));
    if (payload.usage) blocks.push(`${payload.usage.label}, ${payload.usage.aside}`);
    if (payload.problem) {
        blocks.push([`What went wrong: ${sentence(payload.problem.title)}`, payload.problem.help, payload.problem.raw, payload.problem.where].filter(Boolean).join("\n"));
    }
    if (payload.destinations?.length) {
        blocks.push(["Destinations", ...payload.destinations.map((dest) => `${dest.name}: ${dest.detail}${dest.error ? ` (${dest.error})` : ""}`)].join("\n"));
    }
    if (payload.note) blocks.push(payload.note);
    const details = detailsOf(payload);
    if (details.length) blocks.push(details.map((row) => `${row.name}: ${row.value}`).join("\n"));
    const links = (payload.actions ?? []).flatMap((action) => {
        const href = absoluteHref(action.href, brand.baseUrl);
        return href ? [`${action.label}: ${href}`] : [];
    });
    if (links.length) blocks.push(links.join("\n"));
    blocks.push([payload.reason, `DBackup${brand.instanceName ? ` · ${brand.instanceName}` : ""}${brand.baseUrl ? ` · ${brand.baseUrl}` : ""}`].filter(Boolean).join("\n"));
    return `${blocks.join("\n\n")}\n`;
}

/** The whole mail of a notification, its subject, its HTML and its plain text. */
export async function renderNotificationEmail(payload: NotificationPayload, brand: NotificationBrand = DEFAULT_BRAND): Promise<RenderedEmail> {
    // Loaded when a mail is sent, so react-dom/server never lands in the graph of a page.
    const { renderToStaticMarkup } = await import("react-dom/server");
    const body = renderToStaticMarkup(<NotificationEmail payload={payload} brand={brand} />);
    const subject = payload.title;
    const html = [
        "<!DOCTYPE html>",
        '<html lang="en"><head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="color-scheme" content="light dark">',
        '<meta name="supported-color-schemes" content="light dark">',
        `<title>${escapeHtml(subject)}</title>`,
        `<style>:root{color-scheme:light dark;supported-color-schemes:light dark}body{margin:0;padding:0}a{text-decoration:none}${PHONE_CSS}${darkModeCss()}</style>`,
        "</head>",
        `<body class="m-page" style="margin:0;padding:0;background-color:${LIGHT.page}">`,
        preheaderHtml(payload.preheader ?? payload.message),
        body,
        "</body></html>",
    ].join("");
    return { subject, html, text: emailText(payload, brand) };
}
