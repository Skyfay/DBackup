/**
 * The names in a notification, of a job, a database or a tenant, are chosen by people, also by the
 * customers of a provider whose channel they share. Every chat shows them as text: never a link, a
 * mention or markup of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeAdaptiveCard, escapeMarkdown, escapeSlack, escapeTelegramMarkdown, escapeMarkdownLinks } from "@/lib/adapters/notification/escape";
import { SlackAdapter } from "@/lib/adapters/notification/slack";
import { DiscordAdapter } from "@/lib/adapters/notification/discord";
import { TelegramAdapter } from "@/lib/adapters/notification/telegram";
import { GotifyAdapter } from "@/lib/adapters/notification/gotify";
import { NtfyAdapter } from "@/lib/adapters/notification/ntfy";
import { TeamsAdapter } from "@/lib/adapters/notification/teams";
import { GenericWebhookAdapter } from "@/lib/adapters/notification/generic-webhook";

const mockFetch = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
    vi.restoreAllMocks();
});

const JOB = "Shop <!channel> [click](https://evil.example) <@U123> & *bold*";
const context = (extra: Record<string, unknown> = {}) => ({ title: `Backup of ${JOB}`, success: true, fields: [{ name: "Job", value: JOB }], ...extra });
const body = () => JSON.parse(mockFetch.mock.calls[0][1].body as string);

describe("the escapes of each format", () => {
    it("turns the control characters of Slack into entities", () => {
        expect(escapeSlack("a & <!here> <http://x|y>")).toBe("a &amp; &lt;!here&gt; &lt;http://x|y&gt;");
    });

    it("escapes the characters of a link, a mention, emphasis and a heading in Markdown", () => {
        expect(escapeMarkdown("[x](http://e) <@1> *b* _i_ `c` ~s~ ||sp||")).toBe("\\[x\\](http://e) \\<@1\\> \\*b\\* \\_i\\_ \\`c\\` \\~s\\~ \\|\\|sp\\|\\|");
        expect(escapeMarkdown("# Heading\n- item")).toBe("\\# Heading\n\\- item");
    });

    it("keeps a closing bracket of an Adaptive Card away from the parenthesis of a link", () => {
        expect(escapeAdaptiveCard("[x](http://e) <y>")).toBe("\\[x\\]\u200B(http://e) \\<y\\>");
    });

    it("escapes the characters of Telegram's legacy Markdown", () => {
        expect(escapeTelegramMarkdown("my_job *x* [y](z) `c`")).toBe("my\\_job \\*x\\* \\[y](z) \\`c\\`");
    });
});

describe("a notification with a name that looks like markup", () => {
    it("reaches Slack as text, in the message and in the fields", async () => {
        await SlackAdapter.send({ webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx" }, `Finished ${JOB}`, context());

        const blocks = body().attachments[0].blocks;
        const sent = JSON.stringify(blocks.slice(1));
        expect(sent).not.toContain("<!channel>");
        expect(sent).not.toContain("<@U123>");
        expect(sent).not.toContain("<https://");
        expect(blocks[1].text.text).toBe(`Finished ${escapeSlack(JOB)}`);
        expect(blocks[2].fields[0].text).toBe(`*Job:*\n${escapeSlack(JOB)}`);
    });

    it("reaches Slack as text without a context too", async () => {
        await SlackAdapter.send({ webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx" }, `Finished ${JOB}`);

        expect(body().text).toBe(`Finished ${escapeSlack(JOB)}`);
    });

    it("pings nobody on Discord and shows no masked link", async () => {
        await DiscordAdapter.send({ webhookUrl: "https://discord.com/api/webhooks/1/abc" }, `@everyone ${JOB}`, context());

        const sent = body();
        expect(sent.allowed_mentions).toEqual({ parse: [] });
        expect(sent.embeds[0].description).toBe(escapeMarkdown(`@everyone ${JOB}`));
        expect(sent.embeds[0].fields[0].value).toBe(escapeMarkdown(JOB));
        expect(sent.embeds[0].description).not.toContain("[click](");
    });

    it("pings nobody on Discord without a context either", async () => {
        await DiscordAdapter.send({ webhookUrl: "https://discord.com/api/webhooks/1/abc" }, "@everyone <@&42>");

        expect(body()).toMatchObject({ content: "@everyone \\<@&42\\>", allowed_mentions: { parse: [] } });
    });

    it("is escaped for HTML on Telegram, where tags of a name never count", async () => {
        await TelegramAdapter.send({ botToken: "1:abc", chatId: "1", parseMode: "HTML", disableNotification: false }, `<a href="https://evil">x</a>`, context());

        const sent = body();
        expect(sent.parse_mode).toBe("HTML");
        expect(sent.text).toContain("&lt;a href=\"https://evil\"&gt;x&lt;/a&gt;");
        expect(sent.text).not.toContain("<a ");
    });

    it("is escaped for Markdown on Telegram when the channel sends Markdown, with no HTML tag in it", async () => {
        await TelegramAdapter.send({ botToken: "1:abc", chatId: "1", parseMode: "Markdown", disableNotification: false }, "Done my_job [x](https://evil)", context());

        const sent = body();
        expect(sent.parse_mode).toBe("Markdown");
        expect(sent.text).not.toContain("<b>");
        expect(sent.text).toContain("Done my\\_job \\[x](https://evil)");
        // A fixed label is bold, a title with a character to escape is plain text.
        expect(sent.text).toContain("*Job:*");
        expect(sent.text).toContain(escapeTelegramMarkdown(`Backup of ${JOB}`));
    });

    // Their phone apps show the text as sent, so only what makes a link is escaped there.
    it("never makes a link on Gotify, title and fields included, and keeps other characters as written", async () => {
        await GotifyAdapter.send({ serverUrl: "https://gotify.example.com", appToken: "t", priority: 5 }, `Finished ${JOB}`, context());

        const { message } = body();
        expect(message).toContain(`## ${escapeMarkdownLinks(`Backup of ${JOB}`)}`);
        expect(message).toContain(`**Job:** ${escapeMarkdownLinks(JOB)}`);
        expect(message).not.toMatch(/(^|[^\\])\[click\]/);
        expect(message).toContain("& *bold*");
    });

    it("never makes a link on ntfy, which renders the body as Markdown in its web app only", async () => {
        await NtfyAdapter.send({ serverUrl: "https://ntfy.sh", topic: "backups", priority: 3 }, `Finished ${JOB}`, context());

        const [, init] = mockFetch.mock.calls[0];
        expect(init.headers.Markdown).toBe("yes");
        expect(init.body).toBe(`${escapeMarkdownLinks(`Finished ${JOB}`)}\n\nJob: ${escapeMarkdownLinks(JOB)}`);
        expect(init.body).not.toMatch(/(^|[^\\])\[click\]/);
    });

    it("never makes a link in a Teams card, in its texts and in its facts", async () => {
        await TeamsAdapter.send({ webhookUrl: "https://example.webhook.office.com/x" }, `Finished ${JOB}`, context());

        const card = body().attachments[0].content.body;
        const texts = [card[0].text, card[1].text, card[2].facts[0].title, card[2].facts[0].value];
        expect(card[0].text).toBe(escapeAdaptiveCard(`Backup of ${JOB}`));
        expect(card[1].text).toBe(escapeAdaptiveCard(`Finished ${JOB}`));
        expect(card[2].facts[0].value).toBe(escapeAdaptiveCard(JOB));
        for (const text of texts) expect(text).not.toMatch(/\]\(/);
        expect(card[1].text).not.toMatch(/(^|[^\\])\[click/);
    });

    it("changes only the text of a JSON string in the template of a Generic Webhook", async () => {
        const name = `Eve", "event_action": "resolve", "x": {"y": "\\`;
        const payloadTemplate = '{"event_action": "trigger", "payload": {"summary": "{{title}}: {{message}}", "fields": {{fields}}}}';
        await GenericWebhookAdapter.send({ webhookUrl: "https://hooks.example.com/in", method: "POST", contentType: "application/json", payloadTemplate }, `${name} signed in\nagain`, context({ title: `${name} signed in`, fields: [{ name: "User", value: name }] }));

        const sent = body();
        expect(Object.keys(sent)).toEqual(["event_action", "payload"]);
        expect(sent.event_action).toBe("trigger");
        expect(sent.payload.summary).toBe(`${name} signed in: ${name} signed in\nagain`);
        expect(sent.payload.fields).toEqual([{ name: "User", value: name }]);
    });

    it("encodes the text for a form, and leaves it as it is for any other Content-Type of the template", async () => {
        const name = "Eve&event_action=resolve";
        const sentAs = async (contentType: string, payloadTemplate: string) => {
            mockFetch.mockClear();
            await GenericWebhookAdapter.send({ webhookUrl: "https://hooks.example.com/in", method: "POST", contentType, payloadTemplate }, `${name}\nagain`, context({ title: name }));
            return mockFetch.mock.calls[0][1].body as string;
        };

        const form = new URLSearchParams(await sentAs("application/x-www-form-urlencoded; charset=utf-8", "event_action=trigger&summary={{message}}"));
        expect([...form.keys()]).toEqual(["event_action", "summary"]);
        expect(form.get("summary")).toBe(`${name}\nagain`);

        expect(await sentAs("text/plain", "{{title}}: {{message}}")).toBe(`${name}: ${name}\nagain`);
    });

    it("adds no parameter to a form through the fields either, from a name or from an error text", async () => {
        const name = "db&priority=-2&url=https://attacker.example/x";
        const fields = [{ name: "Source", value: name }, { name: "Last Error", value: "connect failed&priority=-2" }];
        const payloadTemplate = "token=T&priority=1&title={{title}}&message={{message}}&fields={{fields}}";
        await GenericWebhookAdapter.send({ webhookUrl: "https://hooks.example.com/in", method: "POST", contentType: "application/x-www-form-urlencoded", payloadTemplate }, `${name} is offline`, context({ title: `${name} is offline`, fields }));

        const form = new URLSearchParams(mockFetch.mock.calls[0][1].body as string);
        expect([...form.keys()]).toEqual(["token", "priority", "title", "message", "fields"]);
        expect(form.getAll("priority")).toEqual(["1"]);
        expect(JSON.parse(form.get("fields")!)).toEqual(fields);
    });

    it("escapes for the Content-Type the request carries, when a custom header replaces the one of the field", async () => {
        const name = `nightly","severity":"info","x":"`;
        const payloadTemplate = '{"text":"{{title}}","severity":"critical"}';
        await GenericWebhookAdapter.send({ webhookUrl: "https://hooks.example.com/in", method: "POST", contentType: "text/plain", customHeaders: "content-type: application/json", payloadTemplate }, "Finished", context({ title: name }));

        expect(body()).toEqual({ text: name, severity: "critical" });
    });

    it("adds no element to an XML template, through a text or through the fields", async () => {
        const name = "x</title><severity>info</severity><title>y";
        const payloadTemplate = "<alert><title>{{title}}</title><severity>critical</severity><fields>{{fields}}</fields></alert>";
        await GenericWebhookAdapter.send({ webhookUrl: "https://hooks.example.com/in", method: "POST", contentType: "application/xml; charset=utf-8", payloadTemplate }, "Offline", context({ title: name, fields: [{ name: "Source", value: name }] }));

        const sent = mockFetch.mock.calls[0][1].body as string;
        expect(sent.match(/<severity>/g)).toHaveLength(1);
        expect(sent.match(/<title>/g)).toHaveLength(1);
        expect(sent).toContain("<title>x&lt;/title&gt;&lt;severity&gt;info&lt;/severity&gt;&lt;title&gt;y</title>");
    });

    it("shows the title and the name of a field as text on Discord too", async () => {
        await DiscordAdapter.send({ webhookUrl: "https://discord.com/api/webhooks/1/abc" }, "Finished", context({ fields: [{ name: JOB, value: "ok" }] }));

        const [embed] = body().embeds;
        expect(embed.title).toBe(escapeMarkdown(`Backup of ${JOB}`));
        expect(embed.fields[0].name).toBe(escapeMarkdown(JOB));
        expect(embed.title).not.toContain("[click](");
    });

    it("sends an ntfy title with a line break or a letter beyond ASCII as one valid header", async () => {
        await NtfyAdapter.send({ serverUrl: "https://ntfy.sh", topic: "backups", priority: 3 }, "Finished", context({ title: "Backup of shop\r\nPriority: 1" }));
        expect(mockFetch.mock.calls[0][1].headers.Title).toBe("Backup of shop Priority: 1");

        mockFetch.mockClear();
        await NtfyAdapter.send({ serverUrl: "https://ntfy.sh", topic: "backups", priority: 3 }, "Finished", context({ title: "Backup of 店" }));
        const title = mockFetch.mock.calls[0][1].headers.Title as string;
        expect(title).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
        expect(Buffer.from(title.slice(10, -2), "base64").toString("utf8")).toBe("Backup of 店");
    });
});
