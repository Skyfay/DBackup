import { z } from "zod";
import type { CredentialType } from "@/lib/core/credentials";

export type AdapterDefinition = {
    id: string;
    type: 'database' | 'storage' | 'notification';
    name: string;
    group?: string;
    /** Marks the adapter as Beta in adapter-picker UI (e.g. newly added, not yet fully battle-tested). */
    beta?: boolean;
    configSchema: z.ZodObject<any>;
    /**
     * `primary` declares the credential type for the primary slot.
     * `primaryOptional: true` means the adapter can work without a credential
     * profile (e.g. Redis without auth, SMTP with an unauthenticated relay).
     * When no profile is assigned and `primaryOptional` is true, the structural
     * config fields (inline user/password) are used as-is.
     */
    credentials?: { primary?: CredentialType; ssh?: CredentialType; primaryOptional?: boolean };
}

// Validation: Reject paths with null bytes or obvious shell injection patterns
export const safePathRegex = /^[^\0]+$/;
export const safePath = (description: string) =>
    z.string().min(1, `${description} is required`).regex(safePathRegex, "Path contains invalid characters");

// Validation: Binary paths must not contain shell metacharacters beyond basic path chars
export const safeBinaryPath = z.string().regex(
    /^[a-zA-Z0-9/_\-.]+$/,
    "Binary path may only contain letters, digits, slashes, underscores, hyphens, and dots"
);

// Shared SSH fields for adapters that support SSH remote execution mode
export const sshFields = {
    connectionMode: z.enum(["direct", "ssh"]).default("direct").describe("Connection mode (direct TCP or via SSH)"),
    sshHost: z.string().optional().describe("SSH host"),
    sshPort: z.coerce.number().default(22).optional().describe("SSH port"),
    sshUsername: z.string().optional().describe("SSH username"),
    sshAuthType: z.enum(["password", "privateKey", "agent"]).default("password").optional().describe("SSH authentication method"),
    sshPassword: z.string().optional().describe("SSH password"),
    sshPrivateKey: z.string().optional().describe("SSH private key (PEM format)"),
    sshPassphrase: z.string().optional().describe("Passphrase for SSH private key"),
};
