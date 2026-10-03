/**
 * The pictures of the people, shown in the sidebar and beside their names. They live in the
 * database like the picture of the login page, so a configuration backup brings them back and
 * DBackup keeps nothing but its database and certificates under DATA_DIR. A picture is checked by
 * its first bytes, never by its name, and `User.image` holds its address with its time.
 */

import prisma from "@/lib/prisma";
import { imageTypeOf, type ImageType } from "@/lib/core/image-type";
import { ValidationError } from "@/lib/logging/errors";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Where a picture is served. The time changes with the picture, so a browser never keeps an old one. */
export function avatarUrl(userId: string, updatedAt: Date): string {
    return `/api/avatar/${encodeURIComponent(userId)}?v=${updatedAt.getTime()}`;
}

/** Keeps a picture whose type is known in place of the one before, and points the person at it. */
export async function storeAvatar(userId: string, mimeType: ImageType, bytes: Uint8Array): Promise<string> {
    const updatedAt = new Date();
    const url = avatarUrl(userId, updatedAt);
    const fields = { mimeType, size: bytes.length, data: Buffer.from(bytes), updatedAt };
    await prisma.$transaction([
        prisma.avatar.upsert({ where: { userId }, create: { userId, ...fields }, update: fields }),
        prisma.user.update({ where: { id: userId }, data: { image: url } }),
    ]);
    return url;
}

/** A new picture of a person, answered with its address. Throws a ValidationError for a file it refuses. */
export async function saveAvatar(userId: string, bytes: Uint8Array): Promise<string> {
    if (bytes.length === 0) throw new ValidationError("The file is empty.", { field: "avatar" });
    if (bytes.length > AVATAR_MAX_BYTES) throw new ValidationError("The picture is larger than 5 MB.", { field: "avatar" });
    const mimeType = imageTypeOf(bytes);
    if (!mimeType) throw new ValidationError("Only a PNG, JPG, GIF or WebP picture works here.", { field: "avatar" });
    return storeAvatar(userId, mimeType, bytes);
}

/** Removes the picture of a person, who shows with initials again. */
export async function removeAvatar(userId: string): Promise<void> {
    await prisma.$transaction([
        prisma.avatar.deleteMany({ where: { userId } }),
        prisma.user.update({ where: { id: userId }, data: { image: null } }),
    ]);
}

/**
 * The picture a part of its address names: a person's id, or a file name of the versions that kept
 * pictures as files, like `<id>-1727000000000.png`, which a session may still hold for a while.
 */
export async function findAvatar(name: string): Promise<{ data: Uint8Array; mimeType: ImageType } | null> {
    const legacy = /^(.+)-\d{10,}(\.[a-z0-9]+)?$/i.exec(name);
    for (const userId of legacy ? [name, legacy[1]] : [name]) {
        const row = await prisma.avatar.findUnique({ where: { userId }, select: { data: true, mimeType: true } });
        if (row) return { data: new Uint8Array(row.data), mimeType: row.mimeType as ImageType };
    }
    return null;
}
