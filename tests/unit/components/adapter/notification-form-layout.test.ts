import { describe, expect, it } from "vitest";
import { getAdapterDefinition, type AdapterDefinition } from "@/lib/adapters/definitions";
import { LOGIN_KEY } from "@/components/adapter/connection-form-layout";
import { notificationLayout } from "@/components/adapter/notification-form-layout";

function adapter(id: string): AdapterDefinition {
    const definition = getAdapterDefinition(id);
    if (!definition) throw new Error(`No adapter ${id}`);
    return definition;
}

const part = (id: string, section: string) => notificationLayout(adapter(id)).find((entry) => entry.id === section);

describe("notification form parts", () => {
    it("gives a Teams webhook a single part, since it has nothing to say about the message", () => {
        expect(notificationLayout(adapter("teams")).map((section) => section.id)).toEqual(["connection"]);
    });

    it("keeps the webhook in the connection and the look of the message apart", () => {
        expect(part("discord", "connection")?.expects).toContain(LOGIN_KEY);
        expect(part("discord", "message")?.keys).toEqual(["username", "avatarUrl"]);
    });

    it("puts the mail server first and sender and recipients into the message", () => {
        expect(part("email", "connection")?.keys).toEqual(expect.arrayContaining(["host", "port", "secure", LOGIN_KEY]));
        // An unauthenticated relay needs no login, so none is expected.
        expect(part("email", "connection")?.expects).not.toContain(LOGIN_KEY);
        expect(part("email", "message")?.expects).toEqual(["from", "to"]);
    });

    it("expects the topic of an ntfy channel but not its token, which only protected topics need", () => {
        expect(part("ntfy", "connection")?.expects).toContain("topic");
        expect(part("ntfy", "connection")?.expects).not.toContain(LOGIN_KEY);
    });

    it("lists how a Telegram message is sent in the message part", () => {
        expect(part("telegram", "message")?.keys).toEqual(["parseMode", "disableNotification"]);
    });
});
