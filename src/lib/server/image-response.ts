import type { ImageType } from "@/lib/core/image-type";

/**
 * The types a stored picture is served with, the ones `imageTypeOf` reads from the bytes of an
 * upload. A row of any other type, like one an older version or a hand edit of the database left,
 * is never served, since its type would decide how the browser runs it.
 */
const SERVED_TYPES: ReadonlySet<string> = new Set<ImageType>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The type a stored picture is served with, or null for one that is never served. */
export function servedImageType(mimeType: string | null | undefined): ImageType | null {
    return mimeType && SERVED_TYPES.has(mimeType) ? (mimeType as ImageType) : null;
}

/**
 * The headers every picture goes out with besides its type: the browser never guesses another type,
 * and a picture opened on its own address runs no script and loads nothing, whatever its bytes hold.
 */
export const IMAGE_SECURITY_HEADERS = {
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "X-Content-Type-Options": "nosniff",
} as const;
