# Backup Encryption & Disaster Recovery

## 1. Overview
The Database Backup Manager uses a **two-layer encryption architecture** to ensure maximum security for both the application configuration and the actual backup artifacts.

1.  **System Encryption (Data-at-Rest)**: Protects credentials stored in the application database.
2.  **Backup Encryption (Profiles)**: Protects backup files sent to external storage.

## 2. Architecture

### 2.1 System Key (`ENCRYPTION_KEY`)
*   **Source**: Environment Variable (`ENCRYPTION_KEY`).
*   **Usage**:
    -   Encrypts sensitive database fields (e.g., Database Passwords, S3 Secret Keys).
    -   Encrypts the **Master Keys** of the Encryption Profiles.
*   **Algorithm**: AES-256-GCM.
*   **Criticality**: If this key is lost, the application cannot decrypt any stored credentials or backup keys.

### 2.2 Encryption Profiles
*   **Concept**: Users create "Profiles" in the Vault.
*   **Master Key**: Each profile generates a cryptographic random **32-byte (256-bit) Master Key**.
*   **Storage**: The Master Key is encrypted with the System Key and stored in the SQLite database.
*   **Usage**: Used to encrypt the actual backup streams.

---

## 3. Backup Process (Encryption Pipeline)
When a backup job is configured with an Encryption Profile, the data flows through a streaming pipeline:

```mermaid
graph LR
    DB[(Database)] -->|Dump Stream| COMP[Compression (Gzip/Brotli)]
    COMP -->|Compressed Stream| ENCR[Encryption (AES-256-GCM)]
    ENCR -->|Encrypted Stream| STORAGE[Storage Adapter]
```

### Technical Details
*   **Algorithm**: AES-256-GCM (Galois/Counter Mode).
*   **IV (Initialization Vector)**: A unique random IV is generated for **every execution**.
*   **Auth Tag**: Generated at the end of the stream to verify integrity.
*   **Artifacts**:
    1.  `backup.sql.gz.enc`: The encrypted binary file.
    2.  `backup.sql.gz.enc.meta.json`: Sidecar file containing metadata.

#### Metadata File (`.meta.json`)
Allows the system to decrypt the file later.
```json
{
  "encryption": {
    "enabled": true,
    "profileId": "uuid-of-profile",
    "iv": "hex-encoded-iv",
    "authTag": "hex-encoded-auth-tag"
  },
  "compression": "BROTLI",
  "engineVersion": "8.0.33"
}
```

---

## 4. Restore Process
The restore process reverses the pipeline. It requires the `.meta.json` file to retrieve the IV and Authentication Tag.

1.  **Download**: Fetches `.enc` file and `.meta.json` to temp directory.
2.  **Lookup**: Logic reads `profileId` from metadata.
3.  **Fetch Key**: System looks up the Profile in the local DB and decrypts the Master Key.
4.  **Decrypt**: Streaming decryption using Master Key + IV + AuthTag.
5.  **Restore**: Decrypted stream acts as input for the database CLI tool.

---

## 5. Key Management & Disaster Recovery

**Problem**: If your local server (running this app) dies, you lose the Encryption Profiles linked to your offsite backups. The backups are useless without the key.

**Solution**: The system offers multiple layers of protection.

### 5.1 Exporting Keys (Preparation)
Users should safely store their keys **outside** the application immediately after creation.
*   **Copy Key**: View and copy the raw 64-character Hex string from the UI.
*   **Recovery Kit**: Download a kit containing the key and instructions.

### 5.2 Importing Keys (Recovery)
If the application is reinstalled, the user can restore access to old backups:
1.  Go to **Settings > Vault**.
2.  Click **Import Key**.
3.  Enter a Name and paste the **64-char Hex Master Key**.
4.  The system stores this as a *new* Encryption Profile.

### 5.3 Smart Recovery (Auto-Discovery)
When an imported key creates a new Profile, it gets a **new unique ID (UUID)**.
Old backups, however, still reference the **old Profile ID** in their `.meta.json`.

**The Restore Service handles this automatically:**

1.  **Standard Lookup**: Tries to find a profile with the ID from `.meta.json`.
2.  **Failure**: If not found (e.g., ID mismatch after import), it triggers **Smart Recovery**.
3.  **Heuristic Scan**:
    *   Iterates through **ALL** available local Encryption Profiles.
    *   Attempts to decrypt the first 1KB of the backup file with each candidate key.
    *   **Validation**:
        *   Checks for valid Compression Headers (Gzip/Brotli magic bytes).
        *   Checks for valid Text/SQL content (printable character ratio).
4.  **Match**: If a key successfully decrypts the header, it is used for the full restore.
5.  **Logging**: The user sees `"Smart Recovery Successful: Matched key from profile 'XYZ'"` in the restore logs.

---

## 6. Security Best Practices
*   **Backup the `ENCRYPTION_KEY`**: Keep your `.env` file safe.
*   **Save Master Keys**: Treat profile keys like passwords. Store them in a Password Manager (1Password/Keepass).
*   **Verify Restores**: Regularly test restoring encrypted backups to ensure your key management works.
