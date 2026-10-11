/**
 * What the runner and the restore expect of every destination, against the real servers of the
 * lab: an upload lands under its name, spaces and Unicode included, lists with its size,
 * downloads byte for byte, reads back as text and is gone after a delete.
 */

import { randomBytes, randomUUID } from "crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { registerAdapters } from "@/lib/adapters";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { registry } from "@/lib/core/registry";
import type { StorageAdapter } from "@/lib/core/interfaces";
import { lab } from "./support/lab";

registerAdapters();
const destinations = await prisma.adapterConfig.findMany({ where: { id: { in: Object.values(lab.destinations) } }, orderBy: { name: "asc" } });

// An odd size, so an adapter that pads or cuts at a block shows.
const content = randomBytes(300 * 1024 + 7);
const sidecar = JSON.stringify({ jobName: "Lab Zoë", databases: ["shop", "李雷"] });
const name = "Bäckerei Zoë 🍞 backup.tar";
let local = "";

beforeAll(() => {
    local = mkdtempSync(path.join(os.tmpdir(), "dbackup-lab-storage-"));
    writeFileSync(path.join(local, "upload.bin"), content);
    writeFileSync(path.join(local, "upload.json"), sidecar);
});

afterAll(() => {
    rmSync(local, { recursive: true, force: true });
});

describe.each(destinations)("$name", (destination) => {
    const folder = `contract-${randomUUID().slice(0, 8)}`;
    const remote = `${folder}/${name}`;
    let storage: StorageAdapter;
    let config: Awaited<ReturnType<typeof resolveAdapterConfig>>;

    beforeAll(async () => {
        storage = registry.get(destination.adapterId) as StorageAdapter;
        config = await resolveAdapterConfig(destination);
    });

    it("uploads a file under a name with spaces and Unicode", async () => {
        expect(await storage.upload(config, path.join(local, "upload.bin"), remote)).toBe(true);
    });

    it("lists it with its name, path and size", async () => {
        const files = await storage.list(config, folder);
        expect(files.find((file) => file.name === name)).toMatchObject({ name, path: remote, size: content.length });
    });

    it("downloads it byte for byte", async () => {
        const target = path.join(local, `download-${destination.adapterId}.bin`);
        expect(await storage.download(config, remote, target)).toBe(true);
        expect(readFileSync(target).equals(content)).toBe(true);
    });

    it("reads a sidecar back as text", async () => {
        if (!storage.read) return;
        await storage.upload(config, path.join(local, "upload.json"), `${remote}.meta.json`);
        expect(await storage.read(config, `${remote}.meta.json`)).toBe(sidecar);
    });

    it("deletes it, and only it", async () => {
        expect(await storage.delete(config, remote)).toBe(true);
        const left = (await storage.list(config, folder)).map((file) => file.name);
        expect(left).not.toContain(name);
        if (storage.read) {
            expect(left).toContain(`${name}.meta.json`);
            await storage.delete(config, `${remote}.meta.json`);
        }
    });
});
