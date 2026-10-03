/** What Recently deleted keeps. Templates and groups may follow. */
export const TRASH_KINDS = ["encryptionKey", "credential", "connection", "job", "user"] as const;

export type TrashKind = (typeof TRASH_KINDS)[number];

export function isTrashKind(value: string): value is TrashKind {
    return (TRASH_KINDS as readonly string[]).includes(value);
}

/** How a delete goes: into Recently deleted, or at once for good. */
export interface DeleteOptions {
    /** Skips Recently deleted, for a key that leaked or a user who has to be gone at once. */
    permanently?: boolean;
    /** Who deletes, named in Recently deleted. */
    by?: string | null;
}

/** A deleted record as Recently deleted lists it. */
export interface TrashRow {
    id: string;
    kind: TrashKind;
    recordId: string;
    name: string;
    detail: string | null;
    deletedAt: string;
    deletedByName: string | null;
    /** When Clean old data removes it for good. */
    expiresAt: string;
}

/** What a restore of several deleted records did, one list per outcome. */
export interface TrashRestoreResult {
    restored: { id: string; recordId: string; kind: TrashKind; name: string; notes: string[] }[];
    /** Its name is taken now, the person picks another. */
    conflicts: { id: string; kind: TrashKind; name: string; message: string }[];
    failed: { id: string; name: string; error: string }[];
}
