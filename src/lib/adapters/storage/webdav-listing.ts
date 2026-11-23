import path from "path";
import { Readable } from "stream";
import { parseXML, prepareFileFromProps, type FileStat, type WebDAVClient } from "webdav";
import { ListingTooLargeError } from "@/lib/adapters/storage/common/listing-limits";
import { assertReadSize, collectCapped, isFileTooLarge } from "@/lib/adapters/storage/common/read-limit";

/**
 * The most bytes of one PROPFIND answer, the listing of one folder. A server answers a few hundred
 * bytes of XML per entry, so a folder of several hundred thousand files fits. The server may belong
 * to a customer, and `getDirectoryContents` of the library reads the whole answer into one string
 * before it parses it, without any bound.
 */
export const WEBDAV_MAX_LISTING_BYTES = 256 * 1024 * 1024;

/** The body of a response as a Node stream, whether the fetch underneath handed a Node or a web stream. */
function nodeStreamOf(body: unknown): NodeJS.ReadableStream {
    if (body && typeof (body as { getReader?: unknown }).getReader === "function") {
        return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
    }
    if (body && typeof (body as { pipe?: unknown }).pipe === "function") return body as NodeJS.ReadableStream;
    return Readable.from([]);
}

/** The path of the URL of a connection, like the client of the library takes it as its base. */
function basePathOf(url: string): string {
    let pathname = "/";
    try {
        pathname = new URL(url).pathname || "/";
    } catch { /* the client of the library refuses such a URL first */ }
    return normalisePath(pathname);
}

/** A path with one leading `/` and no trailing one, as the library writes the names of a listing. */
function normalisePath(value: string): string {
    const absolute = value.startsWith("/") ? value : `/${value}`;
    return /^.+\/$/.test(absolute) ? absolute.slice(0, -1) : absolute;
}

/**
 * The entries of one folder, like `getDirectoryContents` of the library answers them, with the
 * answer of the server read up to `maxBytes` and refused past it with a `ListingTooLargeError`. The
 * transfer stops at the first byte past the limit.
 *
 * The request and the names follow `getDirectoryContents` of webdav 5: a `PROPFIND` of depth 1 on
 * the folder with a trailing `/`, the `href` of each entry made relative to the path of the URL of
 * the connection, and the folder itself left out.
 */
export async function listDavFolder(
    client: WebDAVClient,
    connectionUrl: string,
    folder: string,
    maxBytes: number = WEBDAV_MAX_LISTING_BYTES
): Promise<FileStat[]> {
    const requestPath = folder.startsWith("/") ? folder : `/${folder}`;
    const response = await client.customRequest(requestPath.endsWith("/") ? requestPath : `${requestPath}/`, {
        method: "PROPFIND",
        headers: { Accept: "text/plain,application/xml", Depth: "1" },
    });

    let xml: string;
    try {
        const announced = response.headers?.get?.("content-length");
        assertReadSize(announced ? Number(announced) : undefined, maxBytes);
        xml = (await collectCapped(nodeStreamOf(response.body), maxBytes)).toString("utf-8");
    } catch (error) {
        if (isFileTooLarge(error)) {
            throw new ListingTooLargeError(
                `The WebDAV server answered the listing of one folder with more than ${maxBytes} bytes. Back up its subfolders as separate sources.`
            );
        }
        throw error;
    }
    if (!xml) throw new Error("Failed parsing directory contents: Empty response");

    const dav = await parseXML(xml);
    const serverBase = path.posix.join(basePathOf(connectionUrl), "/");
    const ownPath = normalisePath(requestPath);

    return dav.multistatus.response
        .map((item) => {
            const href = String(item.href ?? "").replace(/^https?:\/\/[^/]+/, "");
            const filename = serverBase === "/"
                ? decodeURIComponent(normalisePath(href))
                : normalisePath(path.posix.relative(decodeURIComponent(serverBase), decodeURIComponent(href)));
            // The library fails the same listing on an entry without properties.
            if (!item.propstat) throw new Error("Failed parsing directory contents: an entry has no properties");
            return prepareFileFromProps(item.propstat.prop, filename) as FileStat;
        })
        .filter((item) => item.basename && (item.type === "file" || item.filename !== ownPath));
}
