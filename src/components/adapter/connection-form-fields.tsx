"use client";

import { useFormContext } from "react-hook-form";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import type { CredentialProfileSummary } from "@/components/settings/credential-profile-dialog";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { CredentialPicker } from "./credential-picker";
import { credentialManagedKeys, loginRequired } from "./connection-form-schema";
import { SchemaField } from "./schema-field";
import { ConfigSwitchRow, SwitchList } from "./setting-switches";

/** Whether a schema node is a boolean, under any default or optional wrapper. */
export function isBooleanSchema(node: unknown): boolean {
    let current = node as { _def?: { type?: string; innerType?: unknown } } | undefined;
    while (current?._def) {
        if (current._def.type === "boolean") return true;
        current = current._def.innerType as typeof current;
    }
    return false;
}

interface FieldProps {
    adapter: AdapterDefinition;
    fieldKey: string;
    label?: string;
    /** Replaces the schema's description. An empty string shows none. */
    description?: string;
    sshCredentialId?: string | null;
}

/** A config field as the adapter's schema describes it, left out when the schema has no such key. */
export function ConfigField({ adapter, fieldKey, label, description, sshCredentialId }: FieldProps) {
    const shape = adapter.configSchema.shape as Record<string, never>;
    if (!(fieldKey in shape) || credentialManagedKeys(adapter).has(fieldKey)) return null;
    return (
        <SchemaField
            name={`config.${fieldKey}`}
            fieldKey={fieldKey}
            schemaShape={shape[fieldKey]}
            adapterId={adapter.id}
            label={label}
            description={description}
            descriptionBelow
            sshCredentialId={sshCredentialId}
        />
    );
}

/** Host and port side by side, the port narrow since it never needs more than five digits. */
export function HostPortFields({ adapter, hostKey, portKey, hostLabel = "Host", hostDescription }: {
    adapter: AdapterDefinition;
    hostKey: string;
    portKey: string;
    hostLabel?: string;
    hostDescription?: string;
}) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-3">
            <ConfigField adapter={adapter} fieldKey={hostKey} label={hostLabel} description={hostDescription} />
            {/* The schema calls it "SSH port" or nothing, which the label already says. */}
            <ConfigField adapter={adapter} fieldKey={portKey} label="Port" description="" />
        </div>
    );
}

export function NameField({ placeholder }: { placeholder: string }) {
    const { control } = useFormContext();
    return (
        <FormField
            control={control}
            name="name"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                        <Input placeholder={placeholder} autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

interface LoginProps {
    adapter: AdapterDefinition;
    slot: "primary" | "ssh";
    value: string | null;
    onChange: (id: string | null) => void;
    label?: string;
    onSelectedProfile?: (profile: CredentialProfileSummary | null) => void;
    refreshKey?: number;
}

/** The saved login a connection uses, for the slot its adapter declares. Nothing when it has none. */
export function LoginField({ adapter, slot, value, onChange, label, onSelectedProfile, refreshKey }: LoginProps) {
    const type = slot === "ssh" ? adapter.credentials?.ssh : adapter.credentials?.primary;
    if (!type) return null;
    return (
        <CredentialPicker
            slot={slot}
            requiredType={type}
            value={value}
            onChange={onChange}
            label={label ?? (slot === "ssh" ? "SSH login" : "Login")}
            adapter={adapter}
            // An SSH server always needs a login, the primary slot when the adapter's schema says so.
            required={slot === "ssh" || loginRequired(adapter)}
            onSelectedProfile={onSelectedProfile}
            refreshKey={refreshKey}
        />
    );
}

/** The booleans among these keys, as switches in one frame. */
export function ConfigSwitches({ adapter, keys, copy }: {
    adapter: AdapterDefinition;
    keys: string[];
    copy: Record<string, { title: string; description: string }>;
}) {
    const shape = adapter.configSchema.shape as Record<string, unknown>;
    const switches = keys.filter((key) => isBooleanSchema(shape[key]));
    if (switches.length === 0) return null;
    return (
        <SwitchList>
            {switches.map((key) => (
                <ConfigSwitchRow key={key} fieldKey={key} title={copy[key]?.title ?? key} description={copy[key]?.description} />
            ))}
        </SwitchList>
    );
}
