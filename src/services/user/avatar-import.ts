/**
 * Earlier versions kept the pictures of the people as files under DATA_DIR/storage/avatars, the
 * oldest under public/uploads/avatars. Once at the start this moves every picture a person still
 * points at into the database and removes the folder under DATA_DIR, so DATA_DIR holds the database
 * and the certificates only. A person whose file is gone shows with initials. Whatever fails keeps
 * the files for the next start.
 */

import { readFile, rm, rmdir } from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { imageTypeOf } from "@/lib/core/image-type";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { storeAvatar } from "./avatar-service";

const log = logger.child({ service: "AvatarImport" });

const LEGACY_PREFIXES = ["/api/avatar/", "/uploads/avatars/"];

/** The file an address of a picture kept as a file names, null for every other address. */
export function legacyAvatarFile(image: string | null): string | null {
    // The addresses of pictures in the database carry their time in `?v=`, those of files never did.
    if (!image || image.includes("?")) return null;
    const prefix = LEGACY_PREFIXES.find((start) => image.startsWith(start));
    const name = prefix ? image.slice(prefix.length) : "";
    return name && name !== "." && name !== ".." && path.basename(name) === name ? name : null;
}

/** The bytes of the first folder that holds the file, null when none does. */
async function readFirst(folders: string[], name: string): Promise<Buffer | null> {
    for (const folder of folders) {
        try {
            return await readFile(path.join(folder, name));
        } catch (error: unknown) {
            // A file that is not there is lost, any other problem keeps the folder for the next start.
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    return null;
}

export async function importAvatarFiles(dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data"), appDir = process.cwd()): Promise<void> {
    const storage = path.join(dataDir, "storage");
    const folders = [path.join(storage, "avatars"), path.join(appDir, "public", "uploads", "avatars")];
    try {
        const users = await prisma.user.findMany({
            where: { OR: LEGACY_PREFIXES.map((start) => ({ image: { startsWith: start } })) },
            select: { id: true, image: true },
        });
        let moved = 0;
        let lost = 0;
        for (const user of users) {
            const name = legacyAvatarFile(user.image);
            if (!name) continue;
            const bytes = await readFirst(folders, name);
            const mimeType = bytes ? imageTypeOf(bytes) : null;
            if (bytes && mimeType) {
                await storeAvatar(user.id, mimeType, bytes);
                moved++;
            } else {
                await prisma.user.update({ where: { id: user.id }, data: { image: null } });
                lost++;
            }
        }
        if (moved + lost > 0) log.info("Moved the pictures of the people into the database", { moved, lost });

        // Only once every picture is in. The folder above goes too, but only while it is empty.
        await rm(folders[0], { recursive: true, force: true });
        await rmdir(storage).catch(() => undefined);
    } catch (error: unknown) {
        log.error("Moving the pictures of the people into the database failed", {}, wrapError(error));
    }
}
