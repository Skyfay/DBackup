/**
 * The text of a notification as each chat reads it. A message carries names that people choose,
 * of a job, a database or a tenant, which must show as they are written and never turn into a link,
 * a mention or markup. Each channel escapes every text it puts into its markup with the function of
 * its format.
 */

/** Slack mrkdwn: `&`, `<` and `>` start its control sequences, links and mentions like `<!channel>`. */
export function escapeSlack(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** HTML, for Telegram's `HTML` parse mode. */
export function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Telegram's legacy `Markdown` parse mode, where `_`, `*`, `` ` `` and `[` are escaped with a backslash. */
export function escapeTelegramMarkdown(text: string): string {
    return text.replace(/([_*`[])/g, "\\$1");
}

/**
 * Markdown as Discord renders it: the backslash escapes every character that starts emphasis, code,
 * a spoiler, a link, an image, a mention or HTML, and a `#`, `-` or `+` that starts a line, which
 * would make it a heading or a list.
 */
export function escapeMarkdown(text: string): string {
    return text
        .replace(/([\\`*_~|[\]<>])/g, "\\$1")
        .replace(/^(\s*)([#+-])/gm, "$1\\$2");
}

/**
 * Markdown for Gotify and ntfy, whose phone apps and push popups show the text as it is sent: only
 * what makes a link, an image or HTML is escaped, `[`, `]`, `<` and `>` and a backslash in front of
 * them, so a name never becomes a link while `prod_mysql` still reads as written everywhere.
 */
export function escapeMarkdownLinks(text: string): string {
    return text.replace(/\\(?=[[\]<>])/g, "\\\\").replace(/([[\]<>])/g, "\\$1");
}
