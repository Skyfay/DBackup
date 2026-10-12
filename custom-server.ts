/**
 * DBackup Custom Server - HTTPS by default, HTTP optional.
 *
 * This file replaces the Next.js standalone server.js as the Docker entry point.
 * It creates an HTTPS server (with auto-generated self-signed cert if needed)
 * and delegates request handling to the Next.js application.
 *
 * Environment variables:
 *   DISABLE_HTTPS  - "true" to use plain HTTP (default: false - HTTPS)
 *   PORT           - Listen port (default: 3000)
 *   HOSTNAME       - Bind address (default: "0.0.0.0")
 *   CERTS_DIR      - Directory for tls.crt/tls.key (default: "/data/certs")
 *   TRUSTED_PROXIES - The reverse proxies whose X-Forwarded-For counts, see server/client-address.ts
 */

import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer, type Server } from "node:http";
import { execSync } from "node:child_process";
import type { BlockList } from "node:net";
import path from "node:path";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import next from "next";

import { CLIENT_ADDRESS_HEADER, clientAddressOf, trustedProxiesFrom } from "./server/client-address";

// ── Configuration ──────────────────────────────────────────────
(process.env as Record<string, string | undefined>).NODE_ENV = "production";
process.chdir(__dirname);

const port = parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const disableHttps = process.env.DISABLE_HTTPS === "true";
const certsDir = process.env.CERTS_DIR || "/data/certs";
const certPath = path.join(certsDir, "tls.crt");
const keyPath = path.join(certsDir, "tls.key");
// Checked before anything starts, so an entry with a typo stops the server instead of trusting the wrong proxies.
let trustedProxies: BlockList;
try {
  trustedProxies = trustedProxiesFrom(process.env.TRUSTED_PROXIES);
} catch (err: unknown) {
  console.error(`[Server] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// ── Next.js Setup ────────────────────────────────────────────
// Set standalone config env BEFORE importing next (matches generated server.js)
const nextConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, ".next/required-server-files.json"), "utf8")
).config;
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

const app = next({ dev: false, hostname, port, dir: __dirname, conf: nextConfig });
const handler = app.getRequestHandler();

// ── TLS Certificate Management ────────────────────────────────

function isSelfSigned(): boolean {
  try {
    const info = execSync(`openssl x509 -in "${certPath}" -noout -issuer -subject`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const issuer = info.match(/issuer\s*=\s*(.*)/i)?.[1]?.trim() || "";
    const subject = info.match(/subject\s*=\s*(.*)/i)?.[1]?.trim() || "";
    return issuer === subject;
  } catch {
    return false;
  }
}

function isExpired(): boolean {
  try {
    execSync(`openssl x509 -in "${certPath}" -noout -checkend 0`, {
      stdio: "pipe",
      timeout: 5000,
    });
    return false; // checkend 0 exits 0 if NOT expired
  } catch {
    return true; // exits 1 if expired
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

function generateSelfSignedCert(): void {
  const extraSans = getExtraSansFromAuthUrl();
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
      `-days 365 -nodes -subj "/CN=DBackup/O=DBackup Self-Signed" ` +
      `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1${extraSans}"`,
    { stdio: "pipe", timeout: 30000 }
  );
  execSync(`chmod 600 "${keyPath}"`, { stdio: "pipe" });
  execSync(`chmod 644 "${certPath}"`, { stdio: "pipe" });
}

/**
 * Checks whether the existing self-signed cert covers the hostname from BETTER_AUTH_URL.
 * Returns true if the cert needs to be regenerated.
 */
function selfSignedCertMissesHostname(): boolean {
  const authUrl = process.env.BETTER_AUTH_URL || "";
  if (!authUrl) return false;
  let hostname: string;
  try {
    hostname = new URL(authUrl).hostname;
  } catch {
    return false;
  }
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") return false;
  try {
    const sans = execSync(
      `openssl x509 -in "${certPath}" -noout -ext subjectAltName`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }
    );
    return !sans.includes(hostname);
  } catch {
    return false;
  }
}

function ensureCertificate(): boolean {
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true, mode: 0o700 });
  }

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    // Check if existing cert is expired
    if (isExpired()) {
      if (isSelfSigned()) {
        console.log("[TLS] Self-signed certificate expired - regenerating...");
        try {
          generateSelfSignedCert();
          console.log("[TLS] Self-signed certificate renewed successfully");
          return true;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[TLS] Failed to renew certificate:", message);
          return false;
        }
      } else {
        console.warn(
          "[TLS] WARNING: Custom certificate has expired! " +
            "Upload a new certificate via Settings - Certificate or replace files in the configured CERTS_DIR"
        );
      }
    } else if (isSelfSigned() && selfSignedCertMissesHostname()) {
      console.log(
        "[TLS] Self-signed certificate does not cover the configured hostname - regenerating..."
      );
      try {
        generateSelfSignedCert();
        console.log("[TLS] Self-signed certificate regenerated with updated hostname");
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[TLS] Failed to regenerate certificate:", message);
        return false;
      }
    } else {
      console.log("[TLS] Using existing certificate from configured CERTS_DIR");
    }
    return true;
  }

  console.log("[TLS] No certificate found. Generating self-signed certificate...");
  try {
    generateSelfSignedCert();
    console.log("[TLS] Self-signed certificate generated successfully");
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[TLS] Failed to generate certificate:", message);
    console.error(
      "[TLS] Falling back to HTTP. Install openssl or provide custom certificates."
    );
    return false;
  }
}

// ── Server Start ──────────────────────────────────────────────

app.prepare().then(() => {
  let server: Server;
  let protocol: string;

  const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // The app reads the address of the client from here only. A value the client sent is replaced.
      req.headers[CLIENT_ADDRESS_HEADER] = clientAddressOf(
        req.socket.remoteAddress,
        req.headers["x-forwarded-for"],
        req.headers["x-real-ip"],
        trustedProxies
      );
      await handler(req, res);
    } catch (err) {
      console.error("[Server] Request error:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  };

  if (disableHttps) {
    protocol = "http";
    server = createHttpServer(requestHandler);
    console.log("[Server] HTTPS disabled via DISABLE_HTTPS=true - using HTTP");
  } else {
    const certReady = ensureCertificate();

    if (certReady && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      protocol = "https";
      const tlsOptions = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      };
      server = createHttpsServer(tlsOptions, requestHandler);
      console.log("[Server] HTTPS enabled with certificate from configured CERTS_DIR");
    } else {
      protocol = "http";
      server = createHttpServer(requestHandler);
      console.warn(
        "[Server] WARNING: Falling back to HTTP - certificate generation failed"
      );
    }
  }

  server.listen(port, hostname, () => {
    console.log(
      `[Server] DBackup ready on ${protocol}://${hostname}:${port}`
    );
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`[Server] ${signal} received - shutting down...`);
    server.close(() => {
      console.log("[Server] Closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
});
