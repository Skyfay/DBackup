/**
 * The type of a picture read from its first bytes, never from its name or from the type the browser
 * sends. An SVG is never one of them, since it could carry a script. Shared by the picture of the
 * login page and the pictures of the people.
 */

export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

function ascii(bytes: Uint8Array, from: number, to: number): string {
    return String.fromCharCode(...bytes.subarray(from, to));
}

/** The type of an image by its first bytes, null for anything else, an SVG included. */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length >= png.length && png.every((value, index) => bytes[index] === value)) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return "image/gif";
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
    return null;
}
