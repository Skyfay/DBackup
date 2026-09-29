"use server";

import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import * as certificateService from "@/services/system/certificate-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { certificateChanges, certificateSnapshot, SETTINGS_AREAS } from "@/services/system/settings-audit";

const log = logger.child({ action: "certificate" });

/**
 * Returns information about the current TLS certificate.
 */
export async function getCertificateInfo() {
  await checkPermission(PERMISSIONS.SETTINGS.READ);

  try {
    const info = certificateService.getCertificateInfo();
    return { success: true, data: info };
  } catch (error) {
    log.error("Failed to get certificate info", {}, wrapError(error));
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Uploads a custom TLS certificate and private key.
 * Requires SETTINGS.WRITE permission.
 */
export async function uploadCertificate(formData: FormData) {
  const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

  const certFile = formData.get("certificate") as File | null;
  const keyFile = formData.get("privateKey") as File | null;

  if (!certFile || !keyFile) {
    return { success: false, error: "Certificate and private key are required." };
  }

  // Size limit: 1 MB per file
  const MAX_SIZE = 1024 * 1024;
  if (certFile.size > MAX_SIZE || keyFile.size > MAX_SIZE) {
    return { success: false, error: "File too large. Maximum size is 1 MB." };
  }

  try {
    const certPem = await certFile.text();
    const keyPem = await keyFile.text();

    const before = certificateSnapshot(certificateService.getCertificateInfo());
    certificateService.uploadCertificate(certPem, keyPem);

    log.info("Custom TLS certificate uploaded via Settings UI");
    // What the certificate says about itself, the key only as changed.
    await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, {
      area: SETTINGS_AREAS.CERTIFICATE,
      changes: certificateChanges(before, certificateSnapshot(certificateService.getCertificateInfo())),
    });
    return {
      success: true,
      message: "Certificate uploaded successfully. Restart DBackup to apply the new certificate.",
    };
  } catch (error) {
    log.error("Failed to upload certificate", {}, wrapError(error));
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Regenerates the self-signed TLS certificate.
 * Requires SETTINGS.WRITE permission.
 */
export async function regenerateCertificate() {
  const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

  try {
    const before = certificateSnapshot(certificateService.getCertificateInfo());
    certificateService.regenerateSelfSignedCert();

    log.info("Self-signed TLS certificate regenerated via Settings UI");
    await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, {
      area: SETTINGS_AREAS.CERTIFICATE,
      changes: certificateChanges(before, certificateSnapshot(certificateService.getCertificateInfo())),
    });
    return {
      success: true,
      message: "Self-signed certificate regenerated. Restart DBackup to apply.",
    };
  } catch (error) {
    log.error("Failed to regenerate certificate", {}, wrapError(error));
    return { success: false, error: getErrorMessage(error) };
  }
}
