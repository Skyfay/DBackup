/**
 * Every notification channel the lab has a receiver for, through the Test connection of its form,
 * which sends a test message. The mail is looked for in Mailpit, the others answer for themselves.
 */

import { expect, test } from "@playwright/test";
import { NOTIFY } from "../../lab/src/catalog";
import { ensureGotifyToken } from "../../lab/src/servers";
import { App, unique, type Connection } from "../support/app";
import { lab } from "../support/environment";

const name = unique();
const recipient = `${name}@e2e.dbackup.test`;

const CHANNELS: { key: string; connection: () => Promise<Connection>; login: (app: App) => Promise<string> }[] = [
    {
        key: "email",
        connection: async () => ({ adapterId: "email", config: { host: NOTIFY.mailpit.service, port: 1025, secure: "none", from: "dbackup-e2e@dbackup.test", to: [recipient] } }),
        login: (app) => app.credential(`${name} mail`, "SMTP", { user: "lab", password: "lab-password" }),
    },
    {
        key: "ntfy",
        connection: async () => ({ adapterId: "ntfy", config: { serverUrl: `http://${NOTIFY.ntfy.service}:80`, topic: `dbackup-${name}`, priority: 3 } }),
        login: (app) => app.credential(`${name} ntfy`, "TOKEN", { token: "lab-ntfy-has-no-login" }),
    },
    {
        key: "gotify",
        connection: async () => ({ adapterId: "gotify", config: { serverUrl: `http://${NOTIFY.gotify.service}:80`, priority: 5 } }),
        // Gotify hands out the token of an application only while it runs.
        login: async (app) => app.credential(`${name} gotify`, "TOKEN", { token: await ensureGotifyToken(lab.docker.address, name) }),
    },
    {
        key: "webhook",
        connection: async () => ({ adapterId: "generic-webhook", config: { method: "POST", contentType: "application/json" } }),
        login: (app) => app.credential(`${name} webhook`, "WEBHOOK", { url: `http://${NOTIFY.webhook.service}:8080/${name}` }),
    },
];

for (const channel of CHANNELS) {
    test(`[storage] the ${channel.key} channel sends a test message`, async ({ request }) => {
        const app = new App(request);
        const connection = { ...(await channel.connection()), primaryCredentialId: await channel.login(app) };
        const tested = await app.testConnection(connection);
        expect(tested.success, tested.message).toBe(true);
        await app.connection({ ...connection, name: `${name} ${channel.key}`, type: "notification" });

        if (channel.key === "email") {
            // Mailpit takes the mail and shows it through its API.
            await expect.poll(async () => {
                const response = await fetch(`http://${lab.docker.address}:${NOTIFY.mailpit.uiPort}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`);
                return ((await response.json()) as { messages_count: number }).messages_count;
            }).toBeGreaterThan(0);
        }
    });
}
