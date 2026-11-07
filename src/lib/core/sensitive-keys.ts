/**
 * The fields of a connection config that hold a secret. They are encrypted at rest, never reach
 * the browser in a DTO, and are redacted from the logs. Free of Node imports, so the logger reads
 * it in the browser as well.
 */
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
