import { describe, it, expect } from 'vitest';
import { createEncryptionStream, createDecryptionStream } from '@/lib/crypto-stream';
import { pipeline } from 'stream/promises';
import { Readable, Writable } from 'stream';

describe('Crypto Stream Integrity', () => {
    it('should fail decryption if authTag is tampered', async () => {
        const key = Buffer.alloc(32, 'a'); // Mock Key (32 bytes)
        const inputData = 'Sensible Datenbank Informationen';
        const chunks: Buffer[] = [];

        // 1. Encrypt
        const { stream: encryptStream, getAuthTag, iv } = createEncryptionStream(key);

        // Use a promise pipeline to ensure encryption finishes
        await pipeline(
            Readable.from([inputData]),
            encryptStream,
            new Writable({
                write(chunk, encoding, callback) {
                    chunks.push(chunk);
                    callback();
                }
            })
        );

        const encryptedData = Buffer.concat(chunks);
        const originalAuthTag = getAuthTag();

        // 2. Tamper AuthTag (Simulate corruption)
        const corruptedAuthTag = Buffer.from(originalAuthTag);
        // Flip bits in the first byte
        corruptedAuthTag[0] = corruptedAuthTag[0] ^ 0xFF;

        // 3. Attempt Decrypt with bad tag
        const decryptStream = createDecryptionStream(key, iv, corruptedAuthTag);

        const decryptPromise = pipeline(
            Readable.from([encryptedData]),
            decryptStream,
            new Writable({ write: (chunk, _, cb) => cb() })
        );

        // Assert: Must throw error specifically regarding authentication
        // Typical error from node crypto is "Unsupported state or unable to authenticate data"
        await expect(decryptPromise).rejects.toThrow();
    });

    it('should successfully decrypt with correct authTag', async () => {
        const key = Buffer.alloc(32, 'b');
        const inputData = 'Valid Data';
        const chunks: Buffer[] = [];

        // 1. Encrypt
        const { stream: encryptStream, getAuthTag, iv } = createEncryptionStream(key);

        await pipeline(
            Readable.from([inputData]),
            encryptStream,
            new Writable({
                write(chunk, _, cb) {
                    chunks.push(chunk);
                    cb();
                }
            })
        );

        const encryptedData = Buffer.concat(chunks);
        const authTag = getAuthTag();

        // 2. Decrypt
        const decryptStream = createDecryptionStream(key, iv, authTag);
        const decryptedChunks: Buffer[] = [];

        await pipeline(
            Readable.from([encryptedData]),
            decryptStream,
            new Writable({
                write(chunk, _, cb) {
                    decryptedChunks.push(chunk);
                    cb();
                }
            })
        );

        expect(Buffer.concat(decryptedChunks).toString()).toBe(inputData);
    });
});
