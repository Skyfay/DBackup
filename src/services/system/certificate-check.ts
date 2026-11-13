import { X509Certificate, createPrivateKey, type KeyObject } from "node:crypto";
import { createSecureContext } from "node:tls";
import { ValidationError } from "@/lib/logging/errors";

/**
 * The check of an uploaded certificate and key before they replace the files the server starts
 * with. The server hands both whole files to node:https, which reads every block of them, so every
 * block is checked here and not only the first one, as the openssl commands do.
 */

interface PemBlock {
  label: string;
  pem: string;
}

const PEM_BEGIN = "-----BEGIN ";
const PEM_DASHES = "-----";
/** The longest label of a real block, like `ENCRYPTED PRIVATE KEY`, is far below this. */
const MAX_LABEL = 64;

/** Every PEM block of a file. A BEGIN line without its END line refuses the file. */
function pemBlocks(text: string, what: string): PemBlock[] {
  const invalid = () => new ValidationError(`Invalid ${what} format. Every PEM block needs its BEGIN and END line.`);
  const blocks: PemBlock[] = [];
  // Walked by position, each block once. An expression that looks for the END from every BEGIN
  // takes a time that grows with the square of a file of many BEGIN lines and no END.
  let position = 0;
  for (;;) {
    const start = text.indexOf(PEM_BEGIN, position);
    if (start === -1) break;
    const labelStart = start + PEM_BEGIN.length;
    const labelEnd = text.indexOf(PEM_DASHES, labelStart);
    const label = labelEnd === -1 || labelEnd - labelStart > MAX_LABEL ? "" : text.slice(labelStart, labelEnd);
    if (!/^[A-Z0-9 ]+$/.test(label)) throw invalid();
    const endLine = `-----END ${label}-----`;
    const bodyStart = labelEnd + PEM_DASHES.length;
    const end = text.indexOf(endLine, bodyStart);
    const nextBegin = text.indexOf(PEM_BEGIN, bodyStart);
    if (end === -1 || (nextBegin !== -1 && nextBegin < end)) throw invalid();
    position = end + endLine.length;
    blocks.push({ label, pem: text.slice(start, position) });
  }
  if (blocks.length === 0) throw invalid();
  return blocks;
}

/** The certificates of the file, the one of the server first and its chain after it. */
function certificatesOf(certPem: string): X509Certificate[] {
  return pemBlocks(certPem, "certificate").map((block, index) => {
    if (block.label !== "CERTIFICATE") {
      throw new ValidationError(`The certificate file holds a block that is no certificate (${block.label}). Upload the certificate and its chain only.`);
    }
    try {
      return new X509Certificate(block.pem);
    } catch {
      throw new ValidationError(`Certificate ${index + 1} of the certificate file cannot be read.`);
    }
  });
}

/** The one private key of the file. A key with a passphrase cannot be read, the server has none. */
function privateKeyOf(keyPem: string): KeyObject {
  const blocks = pemBlocks(keyPem, "private key");
  const keys = blocks.filter((block) => block.label.endsWith("PRIVATE KEY"));
  const others = blocks.filter((block) => !block.label.endsWith("PRIVATE KEY") && block.label !== "EC PARAMETERS");
  if (keys.length !== 1 || others.length > 0) {
    throw new ValidationError("The private key file must hold exactly one private key and nothing else.");
  }
  try {
    return createPrivateKey(keys[0].pem);
  } catch {
    throw new ValidationError("The private key cannot be read. Upload it PEM encoded and without a passphrase.");
  }
}

/**
 * Throws a ValidationError unless the server can start with exactly these two texts: every block of
 * the certificate file is a certificate, the key file holds one readable key, that key belongs to
 * the first certificate, and node loads both as the TLS context the HTTPS server is created with.
 */
export function assertServableCertificate(certPem: string, keyPem: string): void {
  const [leaf] = certificatesOf(certPem);
  const key = privateKeyOf(keyPem);

  if (!leaf.checkPrivateKey(key)) {
    throw new ValidationError("Certificate and private key do not match.");
  }

  try {
    createSecureContext({ cert: certPem, key: keyPem });
  } catch {
    throw new ValidationError("The server cannot load this certificate and key. Upload one PEM certificate chain and its private key.");
  }
}
