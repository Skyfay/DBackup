import type { AdapterDefinition } from "@/lib/adapters/definitions";
import { credentialManagedKeys, loginRequired, requiredKeys } from "./connection-form-schema";
import { LOGIN_KEY, NAME_KEY, type SectionLayout } from "./connection-form-layout";
import { NOTIFICATION_CONFIG_KEYS, NOTIFICATION_CONNECTION_KEYS } from "./form-constants";

/** The keys of this adapter that the user types in, from a list and in its order. */
function fieldsOf(adapter: AdapterDefinition, keys: readonly string[]): string[] {
    const shape = adapter.configSchema.shape as Record<string, unknown>;
    const managed = credentialManagedKeys(adapter);
    return keys.filter((key) => key in shape && !managed.has(key));
}

/** Where the message goes, the connection keys of `form-constants.ts` minus what a login profile fills in. */
export function notificationReachKeys(adapter: AdapterDefinition): string[] {
    return fieldsOf(adapter, NOTIFICATION_CONNECTION_KEYS);
}

const CONNECTION_DESCRIPTIONS: Record<string, string> = {
    WEBHOOK: "The webhook DBackup sends its messages to.",
    TOKEN: "The service DBackup sends its messages through, and the token it signs in with.",
    SMTP: "The mail server DBackup sends through.",
};

/**
 * The parts of the form for a notification channel: where the message goes, and what it
 * looks like and who gets it. A channel that has nothing to say about the message, like a
 * Teams webhook, has only the first part.
 */
export function notificationLayout(adapter: AdapterDefinition): SectionLayout[] {
    const reach = notificationReachKeys(adapter);
    const listed = fieldsOf(adapter, NOTIFICATION_CONFIG_KEYS);
    // Any key no list names goes to the message, so a field added to an adapter is never left out.
    const unlisted = fieldsOf(adapter, Object.keys(adapter.configSchema.shape as Record<string, unknown>))
        .filter((key) => !reach.includes(key) && !listed.includes(key));
    const message = [...listed, ...unlisted];
    const primary = adapter.credentials?.primary;

    const sections: SectionLayout[] = [{
        id: "connection",
        label: "Connection",
        description: (primary && CONNECTION_DESCRIPTIONS[primary]) ?? "Where DBackup sends its messages.",
        keys: [NAME_KEY, ...reach, ...(primary ? [LOGIN_KEY] : [])],
        expects: [NAME_KEY, ...requiredKeys(adapter, reach), ...(loginRequired(adapter) ? [LOGIN_KEY] : [])],
    }];

    if (message.length > 0) {
        sections.push({
            id: "message",
            label: "Message",
            description: adapter.id === "email" ? "Who sends the mail and who gets it." : "How the message looks and who gets it.",
            keys: message,
            expects: requiredKeys(adapter, message),
        });
    }
    return sections;
}
