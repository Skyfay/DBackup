/**
 * The names a choice of an adapter form shows for the values its schema stores, which are often
 * codes like `fsn1` or `STANDARD_IA`. Keyed by the field, since a value like `default` means
 * something else in every field. A value without a name here shows with a capital first letter.
 */
const ENUM_LABELS: Record<string, Record<string, string>> = {
    // Hetzner Object Storage
    region: { fsn1: "Falkenstein (fsn1)", nbg1: "Nuremberg (nbg1)", hel1: "Helsinki (hel1)", ash: "Ashburn (ash)" },
    // Amazon S3
    storageClass: { STANDARD: "Standard", STANDARD_IA: "Standard, infrequent access", GLACIER: "Glacier", DEEP_ARCHIVE: "Glacier Deep Archive" },
    // Cloudflare R2
    jurisdiction: { default: "Standard", eu: "EU", fedramp: "FedRAMP" },
    // Email
    secure: { none: "None (insecure)", ssl: "SSL / TLS", starttls: "STARTTLS" },
};

export function enumLabel(fieldKey: string, value: string): string {
    return ENUM_LABELS[fieldKey]?.[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}
