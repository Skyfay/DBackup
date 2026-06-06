
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { EncryptionError } from '@/lib/logging/errors';

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
    /* v8 ignore start */
    const encryptCause = error instanceof Error ? error : undefined;
    /* v8 ignore stop */
    throw new EncryptionError('encrypt', 'Failed to encrypt data', { cause: encryptCause });
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
    /* v8 ignore start */
    const decryptCause = error instanceof Error ? error : undefined;
    /* v8 ignore stop */
    throw new EncryptionError('decrypt', 'Failed to decrypt data', { cause: decryptCause });
  }
}

export const SENSITIVE_KEYS = [
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
  'sshPassword', // SSH tunnel password (legacy inline SSH field)
  'sshPrivateKey', // SSH tunnel private key (legacy inline SSH field)
  'sshPassphrase', // SSH tunnel key passphrase (legacy inline SSH field)
  'clientSecret', // OAuth Client Secret (Google Drive, etc.)
  'refreshToken', // OAuth Refresh Token
  'authHeader', // Generic Webhook Authorization header
  'accountSid', // Twilio Account SID
  'authToken', // Twilio Auth Token
  'appToken', // Gotify application token
  'botToken', // Telegram bot token
  'accessToken', // ntfy access token
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

/**
 * Merges sensitive fields of an incoming (plaintext) config with an existing
 * (plaintext) config, preserving the existing secret whenever the incoming
 * value for a sensitive key is empty or absent.
 *
 * This is the server-side half of the "hasSecret" pattern: the API only ever
 * returns redacted secrets (see `stripSecrets` / the adapter DTO), so an edit
 * round-trip submits empty secret fields. Without this merge, re-encrypting the
 * submitted config would clobber the real secret with an encrypted empty string.
 *
 * Non-sensitive keys are taken verbatim from `incoming`. Nested objects are
 * merged recursively for sensitive keys; non-object structural values pass
 * through from `incoming`.
 */
export function mergeSecrets(incoming: any, existing: any): any {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return incoming;
  }
  const existingObj =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};

  const result: Record<string, any> = { ...incoming };

  const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

  // 1. Sensitive keys present in `incoming`: if empty, restore from existing.
  //    Nested objects merge recursively.
  for (const key of Object.keys(result)) {
    const value = result[key];
    const existingValue = existingObj[key];

    if (value && typeof value === 'object') {
      result[key] = mergeSecrets(value, existingValue);
    } else if (SENSITIVE_KEYS.includes(key) && isEmpty(value) && existingValue !== undefined) {
      result[key] = existingValue;
    }
  }

  // 2. Sensitive keys present in `existing` but absent from `incoming`: restore
  //    them. The API redacts (removes) secret keys, so an edit round-trip omits
  //    untouched secrets entirely — without this they would be lost on save.
  for (const key of Object.keys(existingObj)) {
    if (!(key in result) && SENSITIVE_KEYS.includes(key) && !isEmpty(existingObj[key])) {
      result[key] = existingObj[key];
    }
  }

  return result;
}

/**
 * Recursively removes sensitive fields from a (decrypted) config, returning a
 * config that structurally cannot carry a secret. Unlike `stripSecrets` (which
 * blanks values to `""`), this deletes the keys entirely so a response DTO never
 * even hints at a value. Use together with `getSecretStatus` to tell the client
 * which secrets are set without exposing them.
 */
export function redactSecrets(config: any): any {
  if (!config || typeof config !== 'object') {
    return config;
  }

  if (Array.isArray(config)) {
    return config.map(redactSecrets);
  }

  const result: Record<string, any> = {};
  for (const key of Object.keys(config)) {
    const value = config[key];
    if (SENSITIVE_KEYS.includes(key) && typeof value !== 'object') {
      continue; // drop scalar secret entirely
    }
    result[key] = value && typeof value === 'object' ? redactSecrets(value) : value;
  }
  return result;
}

/**
 * Reports which sensitive top-level keys of a (decrypted) config hold a
 * non-empty value, e.g. `{ clientSecret: true, refreshToken: false }`. Lets the
 * UI render "secret is set, leave blank to keep" without seeing the value.
 */
export function getSecretStatus(config: any): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return status;
  }
  for (const key of Object.keys(config)) {
    if (SENSITIVE_KEYS.includes(key)) {
      const value = config[key];
      status[key] = typeof value === 'string' ? value.length > 0 : value != null;
    }
  }
  return status;
}
