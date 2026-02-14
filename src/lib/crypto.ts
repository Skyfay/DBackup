
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { EncryptionError } from '@/lib/errors';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/**
 * Gets the encryption key from environment variables and ensures it is valid.
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new EncryptionError('encrypt', 'ENCRYPTION_KEY environment variable is not set');
  }

  // The key should be a 32-byte (64 char) hex string for AES-256
  if (keyHex.length !== 64) {
    throw new EncryptionError('encrypt', 'ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypts a text string using AES-256-GCM.
 * Returns the result in format: "iv:authTag:encryptedContent" (hex encoded)
 */
export function encrypt(text: string): string {
  if (!text) return text;

  try {
    const key = getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError('encrypt', 'Failed to encrypt data', { cause: error instanceof Error ? error : undefined });
  }
}

/**
 * Decrypts a text string using AES-256-GCM.
 * Expects format: "iv:authTag:encryptedContent" (hex encoded)
 */
export function decrypt(text: string): string {
  if (!text) return text;

  // Return original text if it doesn't look like our encrypted format
  // simplistic check: contains 2 colons
  if (text.split(':').length !== 3) return text;

  try {
    const key = getEncryptionKey();
    const parts = text.split(':');

    if (parts.length !== 3) {
      throw new EncryptionError('decrypt', 'Invalid encrypted text format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // If decryption fails (e.g. wrong key, modified data, or plain text data)
    // currently we might want to return the original text if it wasn't encrypted?
    // But for security, if it *looked* encrypted but failed, we should probably throw.
    // Use case: migrating existing unencrypted data vs failed decryption.
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError('decrypt', 'Failed to decrypt data', { cause: error instanceof Error ? error : undefined });
  }
}

const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'secretKey',
  'secretAccessKey', // AWS/S3
  'accessKey',
  'accessKeyId', // AWS/S3
  'apiKey',
  'webhookUrl',
  'uri', // MongoDB Connection String
  'passphrase', // SSH Key Passphrase
  'privateKey', // SSH Private Key
  'clientSecret', // OAuth Client Secret (Google Drive, etc.)
  'refreshToken', // OAuth Refresh Token
];


/**
 * Recursively strips sensitive fields from an object (sets them to empty string).
 */
export function stripSecrets(config: any): any {
  if (!config || typeof config !== 'object') {
    return config;
  }

  // Clone to avoid mutation
  const result = Array.isArray(config) ? [...config] : { ...config };

  for (const key of Object.keys(result)) {
    const value = result[key];

    if (typeof value === 'object' && value !== null) {
      result[key] = stripSecrets(value);
    } else if (typeof value === 'string' && SENSITIVE_KEYS.includes(key)) {
      result[key] = "";
    }
  }

  return result;
}

/**
 * Recursively encrypts sensitive fields in an object.
 */
export function encryptConfig(config: any): any {
  if (!config || typeof config !== 'object') {
    return config;
  }

  // Clone to avoid mutation
  const result = Array.isArray(config) ? [...config] : { ...config };

  for (const key of Object.keys(result)) {
    const value = result[key];

    if (typeof value === 'object' && value !== null) {
      result[key] = encryptConfig(value);
    } else if (typeof value === 'string' && SENSITIVE_KEYS.includes(key)) {
      result[key] = encrypt(value);
    }
  }

  return result;
}

/**
 * Recursively decrypts sensitive fields in an object.
 */
export function decryptConfig(config: any): any {
  if (!config || typeof config !== 'object') {
    return config;
  }

  // Clone to avoid mutation
  const result = Array.isArray(config) ? [...config] : { ...config };

  for (const key of Object.keys(result)) {
    const value = result[key];

    if (typeof value === 'object' && value !== null) {
      result[key] = decryptConfig(value);
    } else if (typeof value === 'string' && SENSITIVE_KEYS.includes(key)) {
      result[key] = decrypt(value);
    }
  }

  return result;
}
