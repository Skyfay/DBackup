import { createGzip, createGunzip, createBrotliCompress, createBrotliDecompress, gzip, brotliCompress, constants, type BrotliOptions, type ZlibOptions } from 'zlib';
import { Transform } from 'stream';
import { promisify } from 'util';

const gzipAsync = promisify(gzip) as (input: Buffer, options?: ZlibOptions) => Promise<Buffer>;
const brotliCompressAsync = promisify(brotliCompress) as (input: Buffer, options?: BrotliOptions) => Promise<Buffer>;

export type CompressionType = 'NONE' | 'GZIP' | 'BROTLI';

/**
 * Brotli quality used everywhere compression is applied.
 *
 * Node defaults to 11, the maximum. Measured on a 22 MB SQL dump, dropping to 10 costs 2.5%
 * in size and returns well over half the time (29.8s -> 12.3s). The next step down is a
 * cliff rather than a slope: quality 9 finishes in 0.5s but produces output 85% larger,
 * because 10 and 11 share an expensive backward-reference search that 9 and below do not.
 *
 * So 10 is the only level that keeps what the job form promises with "Brotli (Best
 * Compression)". Anything lower is a different setting, not a faster version of this one -
 * and someone who wants that trade already has Gzip.
 *
 * Safe to change at any time. The level is encoded in the Brotli stream itself, so a decoder
 * never has to know which one produced it and archives written at any level stay readable.
 */
export const BROTLI_QUALITY = 10;

const BROTLI_OPTIONS = { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } };

/**
 * Returns a Transform stream for the specified compression type.
 * Returns null if no compression is requested.
 */
export function getCompressionStream(type: string): Transform | null {
    switch (type) {
        case 'GZIP':
            return createGzip();
        case 'BROTLI':
            return createBrotliCompress(BROTLI_OPTIONS);
        case 'NONE':
        default:
            return null;
    }
}

/**
 * Compresses a buffer in one shot, for payloads small enough to hold in memory.
 *
 * Exists so the Brotli quality above is applied in exactly one place. Calling zlib directly
 * silently picks up Node's default of 11 instead, which is how a buffered path ends up
 * running an order of magnitude slower than the streaming one next to it.
 *
 * Runs in the thread pool of zlib, never on the event loop: a bundle of 4 MB at quality 10
 * takes about two seconds, which a synchronous call would take from every request and every
 * other run of the one process all tenants share. The output is the same bytes either way.
 */
export async function compressBuffer(input: Buffer, type: CompressionType): Promise<Buffer> {
    switch (type) {
        case 'GZIP':
            return gzipAsync(input);
        case 'BROTLI':
            return brotliCompressAsync(input, BROTLI_OPTIONS);
        case 'NONE':
        default:
            return input;
    }
}

/**
 * Returns a Transform stream for the specified decompression type.
 * Returns null if no decompression is needed (NONE).
 */
export function getDecompressionStream(type: string): Transform | null {
    switch (type) {
        case 'GZIP':
            return createGunzip();
        case 'BROTLI':
            return createBrotliDecompress();
        case 'NONE':
        default:
            return null;
    }
}

/**
 * Returns the file extension for the specified compression type.
 * e.g. GZIP -> ".gz"
 */
export function getCompressionExtension(type: string): string {
    switch (type) {
        case 'GZIP': return '.gz';
        case 'BROTLI': return '.br';
        default: return '';
    }
}
