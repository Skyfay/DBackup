/** Fields whose label reads better than the one made from the key. */
const LABELS = new Map<string, string>([
    ["disableSsl", "Disable SSL"],
    ["uri", "URI"],
    ["tls", "Encryption"],
    ["trustServerCertificate", "Trust Server Certificate"],
    ["backupPath", "Backup Path (Server)"],
    ["localBackupPath", "Backup Path (Local)"],
    ["fileTransferMode", "File Transfer Mode"],
    ["requestTimeout", "Request Timeout (ms)"],
    ["sshHost", "SSH Host"],
    ["sshPort", "SSH Port"],
    ["sshUsername", "SSH Username"],
    ["sshAuthType", "SSH Auth Method"],
    ["sshPassword", "SSH Password"],
    ["sshPrivateKey", "SSH Private Key"],
    ["sshPassphrase", "SSH Key Passphrase"],
    ["jurisdiction", "Bucket Jurisdiction"],
]);

/**
 * The label of a config field of a connection, as the connection form shows it and the audit log
 * names it: "Access Key Id" for `accessKeyId`, or a label of its own like "SSH Host".
 */
export function configFieldLabel(fieldKey: string): string {
    const own = LABELS.get(fieldKey);
    if (own) return own;
    const label = fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1);
    return label.replace(/([A-Z])/g, " $1").trim();
}
