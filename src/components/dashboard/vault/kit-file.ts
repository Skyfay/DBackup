/**
 * Reads the keys out of a file from a recovery kit, in the browser: a `.key` file, or the whole kit
 * as a `.zip`. A kit with one key holds `master.key` and names its key in the README, a kit with
 * several holds `keys/<name>.key` and an index in `keys/keys.json`, see `recovery-kit.ts`.
 */

export interface KitKey {
    /** The name the key had in the Vault it came from, when the file says. */
    name: string | null;
    /** Its id there, which its backups name, when the kit says. */
    profileId: string | null;
    key: string;
}

const HEX_KEY = /^[0-9a-fA-F]{64}$/;
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;

/** One file of a zip, still packed. */
interface Entry {
    name: string;
    method: number;
    offset: number;
    size: number;
}

/** The files a zip lists in its central directory at its end. */
function entriesOf(bytes: Uint8Array): Entry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // The end record sits in the last 22 bytes plus a comment of up to 64 KB.
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
        if (view.getUint32(at, true) === END_OF_DIRECTORY) {
            end = at;
            break;
        }
    }
    if (end < 0) throw new Error("This is no zip file.");

    const total = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    const entries: Entry[] = [];
    for (let index = 0; index < total; index++) {
        if (view.getUint32(at, true) !== CENTRAL_HEADER) throw new Error("The zip file is damaged.");
        const method = view.getUint16(at + 10, true);
        const size = view.getUint32(at + 20, true);
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        const offset = view.getUint32(at + 42, true);
        entries.push({ name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)), method, offset, size });
        at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/** The content of one file of the zip as text, inflated by the browser itself. */
async function readEntry(bytes: Uint8Array, entry: Entry): Promise<string> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(entry.offset, true) !== LOCAL_HEADER) throw new Error("The zip file is damaged.");
    const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
    const packed = bytes.slice(start, start + entry.size);
    if (entry.method === 0) return new TextDecoder().decode(packed);
    if (entry.method !== 8) throw new Error("The zip file is packed in a way the browser cannot open.");
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot open a zip. Drop the .key file from it instead.");
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
}

/** The keys a kit holds, with their names from its index or its README. */
async function keysOfZip(bytes: Uint8Array): Promise<KitKey[]> {
    const entries = entriesOf(bytes);
    const byName = new Map(entries.map((entry) => [entry.name.replace(/^\.\//, ""), entry]));

    const single = byName.get("master.key");
    if (single) {
        const readme = byName.get("README.txt");
        const text = readme ? await readEntry(bytes, readme) : "";
        return [{
            name: text.match(/^# Recovery Kit for Profile: (.+)$/m)?.[1].trim() ?? null,
            profileId: text.match(/^Profile ID: (\S+)$/m)?.[1] ?? null,
            key: (await readEntry(bytes, single)).trim(),
        }];
    }

    const known = new Map<string, { name: string; profileId: string | null }>();
    const index = byName.get("keys/keys.json");
    if (index) {
        try {
            const parsed = JSON.parse(await readEntry(bytes, index)) as { keys?: { name?: unknown; file?: unknown; profileId?: unknown }[] };
            for (const item of parsed.keys ?? []) {
                if (typeof item.file === "string" && typeof item.name === "string") {
                    known.set(item.file, { name: item.name, profileId: typeof item.profileId === "string" ? item.profileId : null });
                }
            }
        } catch {
            // Without its index a kit still has its keys, named after their files.
        }
    }
    const files = entries.filter((entry) => /^keys\/[^/]+\.key$/.test(entry.name));
    return Promise.all(files.map(async (entry) => {
        const file = entry.name.slice("keys/".length);
        const listed = known.get(file);
        return { name: listed?.name ?? file.replace(/\.key$/, ""), profileId: listed?.profileId ?? null, key: (await readEntry(bytes, entry)).trim() };
    }));
}

/**
 * The keys in a dropped file. A `.key` file holds one key as text, a kit holds one or several.
 * Throws with a sentence for the user when the file holds none.
 */
export async function keysFromFile(file: File): Promise<KitKey[]> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const zipped = bytes.length >= 4 && new DataView(bytes.buffer).getUint32(0, true) === LOCAL_HEADER;
    const keys = zipped
        ? await keysOfZip(bytes)
        : [{ name: file.name.endsWith(".key") && file.name !== "master.key" ? file.name.slice(0, -4) : null, profileId: null, key: new TextDecoder().decode(bytes).trim() }];
    const valid = keys.filter((entry) => HEX_KEY.test(entry.key));
    if (valid.length === 0) throw new Error(zipped ? "This zip holds no key of a recovery kit." : "This file holds no key. A key is 64 hex characters.");
    return valid;
}
