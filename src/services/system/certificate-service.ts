import { execSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ service: "CertificateService" });

/** Directory where TLS certificates are stored */
const CERTS_DIR = process.env.CERTS_DIR || "/data/certs";
const CERT_PATH = path.join(CERTS_DIR, "tls.crt");
const KEY_PATH = path.join(CERTS_DIR, "tls.key");

export interface CertificateInfo {
  exists: boolean;
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  /** The end of `validTo` as an ISO date, empty when it cannot be read. */
  expiresAt: string;
  /** Past its end. A certificate on its last day is not expired yet, though it has 0 days left. */
  expired: boolean;
  serialNumber: string;
  fingerprint: string;
  /** The names and addresses it is valid for, from its subject alternative names. */
  names: string[];
  isSelfSigned: boolean;
  daysRemaining: number;
  isHttpsEnabled: boolean;
  /** Why the certificate could not be read, when it exists but openssl failed on it. */
  error?: string;
}

/**
 * Returns whether HTTPS is currently enabled.
 */
export function isHttpsEnabled(): boolean {
  return process.env.DISABLE_HTTPS !== "true";
}

/**
 * Checks whether a TLS certificate and key exist.
 */
export function certificateExists(): boolean {
  return existsSync(CERT_PATH) && existsSync(KEY_PATH);
}

/**
 * Returns information about the current TLS certificate.
 */
export function getCertificateInfo(): CertificateInfo {
  const httpsEnabled = isHttpsEnabled();

  if (!certificateExists()) {
    return {
      exists: false,
      issuer: "",
      subject: "",
      validFrom: "",
      validTo: "",
      expiresAt: "",
      expired: false,
      serialNumber: "",
      fingerprint: "",
      names: [],
      isSelfSigned: false,
      daysRemaining: 0,
      isHttpsEnabled: httpsEnabled,
    };
  }

  try {
    const certText = execSync(
      `openssl x509 -in "${CERT_PATH}" -noout -subject -issuer -dates -serial -fingerprint -sha256`,
      { encoding: "utf-8", timeout: 5000 }
    );

    const subject = extractField(certText, "subject=") || "Unknown";
    const issuer = extractField(certText, "issuer=") || "Unknown";
    const notBefore = extractField(certText, "notBefore=") || "";
    const notAfter = extractField(certText, "notAfter=") || "";
    const serial = extractField(certText, "serial=") || "";
    const fingerprint =
      extractField(certText, "sha256 Fingerprint=") ||
      extractField(certText, "SHA256 Fingerprint=") ||
      "";

    const isSelfSigned = subject === issuer || issuer.includes("DBackup Self-Signed");

    let daysRemaining = 0;
    let expiresAt = "";
    let expired = false;
    const expiryDate = notAfter ? new Date(notAfter) : null;
    if (expiryDate && !Number.isNaN(expiryDate.getTime())) {
      const left = expiryDate.getTime() - Date.now();
      daysRemaining = Math.floor(left / (1000 * 60 * 60 * 24));
      expiresAt = expiryDate.toISOString();
      expired = left <= 0;
    }

    return {
      exists: true,
      issuer,
      subject,
      validFrom: notBefore,
      validTo: notAfter,
      expiresAt,
      expired,
      serialNumber: serial,
      fingerprint,
      names: readNames(),
      isSelfSigned,
      daysRemaining,
      isHttpsEnabled: httpsEnabled,
    };
  } catch (error) {
    log.error("Failed to read certificate info", {}, wrapError(error));
    return {
      exists: true,
      issuer: "Error reading certificate",
      subject: "Error reading certificate",
      validFrom: "",
      validTo: "",
      expiresAt: "",
      expired: false,
      serialNumber: "",
      fingerprint: "",
      names: [],
      isSelfSigned: false,
      daysRemaining: 0,
      isHttpsEnabled: httpsEnabled,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The names and addresses the certificate is valid for. An openssl too old for `-ext` gives
 * none, which only leaves out that line.
 */
function readNames(): string[] {
  try {
    const text = execSync(`openssl x509 -in "${CERT_PATH}" -noout -ext subjectAltName`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseNames(text);
  } catch {
    return [];
  }
}

/** "DNS:localhost, IP Address:127.0.0.1" under its heading, as a list. */
export function parseNames(text: string): string[] {
  const lines = text.split("\n");
  const heading = lines.findIndex((line) => line.includes("Subject Alternative Name"));
  if (heading === -1 || !lines[heading + 1]) return [];
  return lines[heading + 1]
    .split(",")
    .map((entry) => entry.trim().replace(/^(DNS|IP Address|IP|email|URI):/i, ""))
    .filter(Boolean);
}

/**
 * Uploads a custom certificate and key.
 * Validates format and matching before saving.
 */
export function uploadCertificate(certPem: string, keyPem: string): void {
  if (!certPem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("Invalid certificate format. Must be PEM encoded.");
  }
  if (!keyPem.includes("-----BEGIN") || !keyPem.includes("PRIVATE KEY-----")) {
    throw new Error("Invalid private key format. Must be PEM encoded.");
  }

  // Ensure directory exists
  if (!existsSync(CERTS_DIR)) {
    mkdirSync(CERTS_DIR, { recursive: true, mode: 0o700 });
  }

  const tmpCert = path.join(CERTS_DIR, "tls.crt.tmp");
  const tmpKey = path.join(CERTS_DIR, "tls.key.tmp");

  try {
    writeFileSync(tmpCert, certPem, { mode: 0o644 });
    writeFileSync(tmpKey, keyPem, { mode: 0o600 });

    // Validate cert is parseable
    execSync(`openssl x509 -in "${tmpCert}" -noout`, {
      stdio: "pipe",
      timeout: 5000,
    });

    // Validate the key is parseable, whatever its type (RSA, EC, Ed25519)
    execSync(`openssl pkey -in "${tmpKey}" -noout`, {
      stdio: "pipe",
      timeout: 5000,
    });

    // The public key in the certificate must be the one of the private key. Comparing them works
    // for every key type, where the modulus only exists for RSA.
    const certPublicKey = execSync(`openssl x509 -in "${tmpCert}" -noout -pubkey`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    const keyPublicKey = execSync(`openssl pkey -in "${tmpKey}" -pubout`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (!certPublicKey || certPublicKey !== keyPublicKey) {
      throw new Error("Certificate and private key do not match.");
    }

    // All validations passed - replace existing files
    renameSync(tmpCert, CERT_PATH);
    renameSync(tmpKey, KEY_PATH);

    log.info("Custom TLS certificate uploaded successfully");
  } catch (error) {
    // Clean up temp files on error
    try {
      if (existsSync(tmpCert)) unlinkSync(tmpCert);
      if (existsSync(tmpKey)) unlinkSync(tmpKey);
    } catch {
      // ignore cleanup errors
    }
    throw error instanceof Error
      ? error
      : new Error(`Certificate validation failed: ${String(error)}`);
  }
}

/**
 * Extracts additional SAN entries from BETTER_AUTH_URL.
 * Returns a comma-prefixed string like ",DNS:myhost.example.com" or ",IP:192.168.1.1",
 * or an empty string if no extra SAN is needed.
 */
function getExtraSansFromAuthUrl(): string {
  const authUrl = process.env.BETTER_AUTH_URL || "";
  if (!authUrl) return "";
  try {
    const hostname = new URL(authUrl).hostname;
    if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") return "";
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
    return isIp ? `,IP:${hostname}` : `,DNS:${hostname}`;
  } catch {
    return "";
  }
}

/**
 * Regenerates the self-signed certificate, replacing the existing one. The new files are made
 * beside the old ones and only replace them once both exist, so a failure keeps the old ones.
 */
export function regenerateSelfSignedCert(): void {
  if (!existsSync(CERTS_DIR)) {
    mkdirSync(CERTS_DIR, { recursive: true, mode: 0o700 });
  }

  const extraSans = getExtraSansFromAuthUrl();
  const newCert = path.join(CERTS_DIR, "tls.crt.new");
  const newKey = path.join(CERTS_DIR, "tls.key.new");

  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${newKey}" -out "${newCert}" ` +
        `-days 365 -nodes -subj "/CN=DBackup/O=DBackup Self-Signed" ` +
        `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1${extraSans}"`,
      { stdio: "pipe", timeout: 30000 }
    );
    execSync(`chmod 600 "${newKey}"`, { stdio: "pipe" });
    execSync(`chmod 644 "${newCert}"`, { stdio: "pipe" });
    renameSync(newKey, KEY_PATH);
    renameSync(newCert, CERT_PATH);
    log.info("Self-signed TLS certificate regenerated successfully");
  } catch (error) {
    log.error("Failed to regenerate certificate", {}, wrapError(error));
    try {
      if (existsSync(newCert)) unlinkSync(newCert);
      if (existsSync(newKey)) unlinkSync(newKey);
    } catch {
      // ignore cleanup errors
    }
    throw new Error(
      "Failed to generate TLS certificate. Is openssl installed?"
    );
  }
}

/** Extract a field value from openssl text output */
function extractField(text: string, prefix: string): string {
  const line = text
    .split("\n")
    .find((l) => l.trim().toLowerCase().startsWith(prefix.toLowerCase()));
  return line ? line.trim().substring(prefix.length).trim() : "";
}
