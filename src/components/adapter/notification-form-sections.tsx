"use client";

import type { AdapterDefinition } from "@/lib/adapters/definitions";
import { ConfigField, ConfigSwitches, HostPortFields, LoginField, NameField, isBooleanSchema } from "./connection-form-fields";
import type { SectionId } from "./connection-form-layout";
import { EmailTagField } from "./email-tag-field";
import { notificationReachKeys } from "./notification-form-layout";
import type { ConnectionSectionProps } from "./use-connection-form";

/** Names that read better than the ones made from the keys. */
const LABELS: Record<string, string> = {
    secure: "Security",
    contentType: "Content type",
    serverUrl: "Server URL",
    chatId: "Chat ID",
    messageThreadId: "Thread ID",
    accountSid: "Account SID",
    username: "Display name",
    avatarUrl: "Avatar URL",
    iconEmoji: "Icon emoji",
    customHeaders: "Extra headers",
    payloadTemplate: "Payload template",
    parseMode: "Parse mode",
};

const DESCRIPTIONS: Record<string, string> = {
    secure: "STARTTLS on port 587 suits most servers, SSL/TLS goes with port 465.",
    method: "",
};

const SWITCHES: Record<string, { title: string; description: string }> = {
    disableNotification: { title: "Send silently", description: "Telegram delivers the message without a sound." },
};

/** The login of each channel under the name its service gives it. */
const LOGIN_LABELS: Record<string, string> = {
    gotify: "App token",
    ntfy: "Access token",
    telegram: "Bot token",
    "twilio-sms": "Auth token",
    email: "SMTP login",
};

function Field({ adapter, fieldKey }: { adapter: AdapterDefinition; fieldKey: string }) {
    return <ConfigField adapter={adapter} fieldKey={fieldKey} label={LABELS[fieldKey]} description={DESCRIPTIONS[fieldKey]} />;
}

function ConnectionPart(props: ConnectionSectionProps) {
    const { adapter } = props;
    const keys = notificationReachKeys(adapter);
    const webhook = adapter.credentials?.primary === "WEBHOOK";

    return (
        <>
            <NameField placeholder="Ops channel" />
            {keys.map((key) => {
                if (key === "port" && keys.includes("host")) return null;
                if (key === "host" && keys.includes("port")) return <HostPortFields key={key} adapter={adapter} hostKey="host" portKey="port" hostLabel="SMTP host" />;
                return <Field key={key} adapter={adapter} fieldKey={key} />;
            })}
            <LoginField
                adapter={adapter}
                slot="primary"
                value={props.primaryCredentialId}
                onChange={props.onPrimaryChange}
                label={webhook ? "Webhook" : LOGIN_LABELS[adapter.id]}
            />
        </>
    );
}

function MessagePart({ adapter, keys }: { adapter: AdapterDefinition; keys: string[] }) {
    const shape = adapter.configSchema.shape as Record<string, unknown>;
    return (
        <>
            {keys.filter((key) => !isBooleanSchema(shape[key])).map((key) =>
                // Email takes several recipients, each checked as it is added.
                adapter.id === "email" && key === "to" ? <EmailTagField key={key} /> : <Field key={key} adapter={adapter} fieldKey={key} />
            )}
            <ConfigSwitches adapter={adapter} keys={keys} copy={SWITCHES} />
        </>
    );
}

/** What one part of a notification form shows. */
export function NotificationSection({ id, keys, ...props }: ConnectionSectionProps & { id: SectionId; keys: string[] }) {
    if (id === "connection") return <ConnectionPart {...props} />;
    if (id === "message") return <MessagePart adapter={props.adapter} keys={keys} />;
    return null;
}

/** A notification part has nothing to test on its own. The whole channel is tested by sending a message. */
export function NotificationSectionAction() {
    return null;
}
