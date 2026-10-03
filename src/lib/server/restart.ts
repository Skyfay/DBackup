import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ module: "Restart" });

/**
 * Ends the process a moment after the answer went out, so its container starts it again, like
 * after a configuration restore. The restart policy of the container brings DBackup back, the
 * compose file and the install guide set `restart: always`. Under `pnpm dev` it stays down.
 */
export function restartSoon(reason: string, delayMs = 1500): void {
    log.info("DBackup restarts", { reason });
    setTimeout(() => void shutdown(), delayMs);
}

async function shutdown(): Promise<void> {
    try {
        // Writes the write-ahead log into the file, so the database it leaves behind is whole.
        await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
        // A restart must not hang on this.
    }
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
}
