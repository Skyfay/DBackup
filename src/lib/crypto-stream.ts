import { Transform } from 'stream';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export interface EncryptionStreamResult {
  stream: Transform;
  getAuthTag: () => Buffer;
  iv: Buffer;
}

/**
 * Creates a transform stream for encrypting data using AES-256-GCM.
 * It automatically generates a random IV.
 *
 * @param key The 32-byte encryption key.
 * @returns An object containing the transform stream, the generated IV, and a function to retrieve the auth tag (available after stream end).
 */
export function createEncryptionStream(key: Buffer): EncryptionStreamResult {
  if (key.length !== 32) {
    throw new Error(`Invalid key length: ${key.length}. Key must be 32 bytes for AES-256-GCM.`);
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // The auth tag is only available after final() has been called on the cipher.
  // The caller must wait for the stream to finish before calling this.
  const getAuthTag = () => cipher.getAuthTag();

  return { stream: cipher, getAuthTag, iv };
}

/**
 * Creates a transform stream for decrypting data using AES-256-GCM.
 *
 * @param key The 32-byte encryption key.
 * @param iv The initialization vector used during encryption.
 * @param authTag The authentication tag generated during encryption.
 * @returns A transform stream that decrypts the data.
 */
export function createDecryptionStream(key: Buffer, iv: Buffer, authTag: Buffer): Transform {
  if (key.length !== 32) {
    throw new Error(`Invalid key length: ${key.length}. Key must be 32 bytes for AES-256-GCM.`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher;
}
