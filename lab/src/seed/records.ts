/**
 * Creates credential profiles and connections through the services the app uses, so the seed
 * stores what the forms store. A record that exists under its name already gets its data
 * brought up to date instead, which moves a copied database to the folders of its workspace.
 */

import prisma from "@/lib/prisma";
import { encryptConfig } from "@/lib/crypto";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import type { CredentialType } from "@/lib/core/credentials";
import { buildConnectionFormSchema } from "@/components/adapter/connection-form-schema";
import { createCredentialProfile, updateCredentialProfile } from "@/services/auth/credential-service";
import { createAdapter } from "@/services/adapters/adapter-create";

export type ConnectionType = "database" | "storage" | "notification";

export interface ConnectionSpec {
    name: string;
    type: ConnectionType;
    adapterId: string;
    config: Record<string, unknown>;
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
    storageRole?: "DESTINATION" | "SOURCE";
}

export async function ensureCredential(name: string, type: CredentialType, data: Record<string, unknown>): Promise<string> {
    const existing = await prisma.credentialProfile.findFirst({ where: { name } });
    if (existing) {
        await updateCredentialProfile(existing.id, { data });
        return existing.id;
    }
    const created = await createCredentialProfile(name, type, data, "Created by the dev lab seed");
    return created.id;
}

/** The flags the connection form saves with each kind of connection. */
function formMetadata(type: ConnectionType): Record<string, unknown> {
    if (type === "database") return { healthNotificationsDisabled: false, isRestoreExcluded: false };
    if (type === "storage") return { healthNotificationsDisabled: false, skipVerification: false, airGapped: false };
    return {};
}

/** Creates a connection, or updates the config and profiles of the one with that name. */
export async function ensureConnection(spec: ConnectionSpec): Promise<{ id: string; created: boolean }> {
    const definition = ADAPTER_DEFINITIONS.find((entry) => entry.id === spec.adapterId);
    if (!definition) throw new Error(`Unknown adapter ${spec.adapterId}`);
    // The schema of the form: the defaults it fills in, without the fields a profile provides.
    const { config } = buildConnectionFormSchema(definition).parse({ name: spec.name, adapterId: spec.adapterId, config: spec.config });

    const existing = await prisma.adapterConfig.findFirst({ where: { name: spec.name, type: spec.type } });
    if (existing) {
        await prisma.adapterConfig.update({
            where: { id: existing.id },
            data: {
                config: JSON.stringify(encryptConfig(config)),
                primaryCredentialId: spec.primaryCredentialId ?? null,
                sshCredentialId: spec.sshCredentialId ?? null,
            },
        });
        return { id: existing.id, created: false };
    }

    const created = await createAdapter({
        name: spec.name,
        type: spec.type,
        adapterId: spec.adapterId,
        config,
        metadata: formMetadata(spec.type),
        primaryCredentialId: spec.primaryCredentialId ?? null,
        sshCredentialId: spec.sshCredentialId ?? null,
        storageRole: spec.storageRole,
    });
    return { id: created.id, created: true };
}
