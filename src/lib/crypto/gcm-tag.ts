/**
 * The length of every GCM tag DBackup writes. Node accepts a shorter tag from the metadata of a file
 * and checks it on fewer bytes, which makes a forged file easier to pass, so a tag of any other
 * length is refused.
 */
export const GCM_TAG_LENGTH = 16;

/** Throws for a tag of another length than DBackup writes, see `GCM_TAG_LENGTH`. */
export function assertAuthTagLength(authTag: Buffer): void {
    if (authTag.length !== GCM_TAG_LENGTH) {
        throw new Error(`Invalid auth tag length: ${authTag.length}. The tag must be ${GCM_TAG_LENGTH} bytes for AES-256-GCM.`);
    }
}
