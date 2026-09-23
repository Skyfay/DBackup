import { describe, expect, it } from "vitest";
import { getAdapterDefinition, type AdapterDefinition } from "@/lib/adapters/definitions";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { defaultConfig, fillRequiredText, initialRole } from "@/components/adapter/connection-form-defaults";

function adapter(id: string): AdapterDefinition {
    const definition = getAdapterDefinition(id);
    if (!definition) throw new Error(`No adapter ${id}`);
    return definition;
}

describe("connection form start values", () => {
    it("starts required text empty, so the adapter's own message shows, but leaves profile fields alone", () => {
        const config = fillRequiredText(adapter("s3-aws"), {});
        expect(config.bucket).toBe("");
        expect(config.region).toBe("");
        // The access keys come from the login profile and must not be sent as empty strings.
        expect(config).not.toHaveProperty("accessKeyId");
        // Optional text stays missing, since an empty string could fail its own format check.
        expect(config).not.toHaveProperty("pathPrefix");
    });

    it("gives a new connection its schema defaults but never picks a connection mode", () => {
        const config = defaultConfig(adapter("postgres"));
        expect(config.port).toBe(5432);
        expect(config).not.toHaveProperty("connectionMode");
    });

    it("keeps an adapter that only works one way round in the role it supports", () => {
        expect(initialRole(adapter("docker-volume"), undefined, STORAGE_ROLES.DESTINATION)).toBe(STORAGE_ROLES.SOURCE);
        expect(initialRole(adapter("sftp"), undefined, STORAGE_ROLES.SOURCE)).toBe(STORAGE_ROLES.SOURCE);
        expect(initialRole(adapter("sftp"), undefined, undefined)).toBe(STORAGE_ROLES.DESTINATION);
    });
});
