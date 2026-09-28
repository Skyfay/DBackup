import { z } from "zod";
import type { CredentialType } from "@/lib/core/credentials";
import type { StorageRole } from "@/lib/core/storage-roles";

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
    /**
     * Storage only: how many files this adapter can usefully transfer at once as a directory
     * source - a suggested starting point and a ceiling the connection may not exceed.
     *
     * Declared here rather than on the runtime adapter because the connection form has to show
     * the range, and the form runs in the browser: importing the runtime adapters there would
     * pull ssh2 and the cloud SDKs into the client bundle. Definitions are plain data.
     *
     * Omit it when the provider handles parallel transfers fine (S3, Google Drive, local),
     * which is the common case - `DEFAULT_TRANSFER_CONCURRENCY` then applies.
     */
    transferConcurrency?: { default: number; max: number };
    /**
     * Storage only: this adapter splits a single upload across parallel parts, and how far the
     * connection may push that.
     *
     * Distinct from `transferConcurrency`, which counts whole files and only applies to a
     * directory source. A backup destination receives one archive per run, so the only place
     * parallelism can happen is inside that one upload. An adapter that uploads as a single
     * stream omits this and shows no field.
     *
     * Here rather than on the runtime adapter for the same reason as transferConcurrency: the
     * connection form runs in the browser, and definitions are plain data.
     */
    multipartUpload?: {
        concurrency: { default: number; max: number };
        partSizeMb: { default: number; max: number };
    };
    /**
     * Storage only: which roles a config of this adapter may be given. Both, when omitted.
     *
     * The role is normally the user's choice, because most storage serves either end - a
     * folder on an SFTP server is as good a backup destination as it is a directory source.
     * Some adapters only work one way round: a container runtime is somewhere to read data
     * out of, never somewhere to put archives, and offering it as a destination would only
     * let someone build a job that fails on its first upload.
     *
     * Here rather than on the runtime adapter for the same reason as transferConcurrency:
     * the role picker runs in the browser, and definitions are plain data.
     */
    supportedRoles?: readonly StorageRole[];
    /**
     * Storage only: this adapter's browse has no level below its root.
     *
     * A Docker volume is a name, not a folder - there is nothing to expand into. The picker
     * would otherwise show an expand control at every row that reveals "No subfolders", and
     * offer a "back up everything" checkbox that stores a root path the adapter cannot read.
     */
    flatBrowse?: true;
    /**
     * Storage only: what one browsable item is called, singular. Defaults to "folder".
     *
     * Used for the picker's own wording, so a volume list does not talk about folders.
     */
    browseNoun?: string;
}

/**
 * Applies to an adapter that declares multipart upload without stating its own range.
 *
 * Eight parts of 8 MB is a deliberate step up from the AWS SDK's own 4 by 5 MB rather than a
 * jump to the ceiling. The two numbers multiply into memory, and the default has to stay
 * reasonable inside a 512 MB container, which is where most self-hosted installations run.
 *
 * Lives here rather than next to the resolver in `s3-upload-tuning.ts` because that module
 * reads `ADAPTER_DEFINITIONS`, and the definitions need this constant to declare themselves.
 * Shared data has to sit below both to keep the import graph acyclic.
 */
export const DEFAULT_S3_UPLOAD_TUNING = {
    concurrency: { default: 8, max: 32 },
    partSizeMb: { default: 8, max: 64 },
} as const;

// Validation: Reject paths with null bytes or obvious shell injection patterns
export const safePathRegex = /^[^\0]+$/;
export const safePath = (description: string) =>
    z.string().min(1, `${description} is required`).regex(safePathRegex, "Path contains invalid characters");

// A part of a path that a URL resolves like "." or "..", also written with %2e.
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

// Validation: The folder of a cloud drive as its browse route takes it, "" for the top. The
// OneDrive route puts it into a URL, where a ".." part would step out of the drive's root.
export const cloudFolderPath = z
    .string()
    .max(4096)
    .refine((value) => !value.includes("\0") && !value.split(/[/\\]/).some((part) => DOT_SEGMENT.test(part)), "Invalid folder path");

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
