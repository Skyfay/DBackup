# Backup Encryption Specification

Dieses Dokument beschreibt die Implementierung der Verschlüsselungsschicht für Backups.

## 1. Architektur & Datenmodell

Wir verwenden einen **Vault-Ansatz**. Das Kennwort/Key wird zentral verwaltet und im Job referenziert.

### Neues Prisma Model (`schema.prisma`)

```prisma
model EncryptionProfile {
  id          String   @id @default(cuid())
  name        String   // z.B. "S3 Offsite Key"
  description String?

  // Der eigentliche 32-Byte Key, mit dem wir die Dateien verschlüsseln.
  // Dieser String ist selbst verschlüsselt mit dem systemweiten ENCRYPTION_KEY (via crypto.ts).
  secretKey   String

  // Optional: Ein Hash der User-Passphrase, falls wir "Passwort bei Restore eingeben" erzwingen wollen.
  // Für Automation ist es aber besser, den Key in der DB zu halten (encrypted at rest).

  jobs        Job[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Update Job Model
model Job {
  // ... existing fields
  encryptionProfileId String?
  encryptionProfile   EncryptionProfile? @relation(fields: [encryptionProfileId], references: [id])
}
```

### Sidecar Metadata (`.meta.json`) Erweiterung

Wir nutzen die existierende Sidecar-Datei, um kryptografische Parameter zu speichern.

```ts
interface BackupMetadata {
    // ... bestehende Felder
    encryption?: {
        enabled: boolean;
        profileId: string;      // Referenz auf DB
        algorithm: 'aes-256-gcm';
        iv: string;             // Hex string (Initialisierungsvektor)
        authTag: string;        // Hex string (GCM Auth Tag - wichtig für Integritätscheck)
    }
}
```

---

## 2. Technische Umsetzung (Streaming)

Wir können `src/lib/crypto.ts` nicht direkt nutzen, da es Strings verarbeitet und Speicher vollaufen lassen würde. Wir benötigen neue Stream-Helfer.

**Neuer Service**: `src/lib/crypto-stream.ts`

*   Muss `crypto.createCipheriv` und `crypto.createDecipheriv` nutzen.
*   Muss als `Transform` Stream fungieren, um in die bestehende Pipeline (`Dump -> Gzip -> Encrypt -> Storage`) eingebaut zu werden.

---

## 3. Implementation Roadmap (TODOs)

### Phase 1: Core Logic & Database
- [x] **Prisma Schema Update**:
    - `EncryptionProfile` Modell erstellen.
    - Relation zu `Job` hinzufügen.
    - `npx prisma migrate dev` ausführen.
- [x] **Crypto Stream Lib**:
    - Erstelle `src/lib/crypto-stream.ts`.
    - Funktion `createEncryptionStream(key: Buffer)` -> `{ stream: Transform, getAuthTag: () => Buffer, iv: Buffer }`.
    - Funktion `createDecryptionStream(key: Buffer, iv: Buffer, authTag: Buffer)` -> `Transform`.

### Phase 2: Service Layer & Runner
- [x] **Profile Service**:
    - `src/services/encryption-service.ts`: CRUD für Profile.
    - Beim Erstellen: Generiere 32 random Bytes -> verschlüssele sie mit `crypto.ts` -> speichere in DB.
- [x] **Backup Runner (`src/lib/runner.ts`)**:
    - Prüfe, ob Job `encryptionProfileId` hat.
    - Wenn ja:
        - Lade Profile, entschlüssele den `secretKey`.
        - Initialisiere `createEncryptionStream`.
        - **Pipeline anpassen**: `.pipe(gzip).pipe(encrypt).pipe(storage)`.
        - Nach Abschluss: `authTag` abrufen und in `metadata` objekt schreiben.
- [ ] **Restore Service (`src/services/restore-service.ts`)**:
    - Prüfe `.meta.json` auf `encryption` Feld.
    - Wenn aktiv:
        - Suche Profile via ID.
        - Initialisiere `createDecryptionStream`.
        - Pipeline beim Lesen vom Storage anpassen.

### Phase 3: UI Implementation
- [x] **Settings / Security Page**:
    - Liste der Encryption Profiles.
    - Modal zum Erstellen ("Name" + "Auto-Generate Key" Button).
- [x] **Job Editor**:
    - Combobox/Select Feld "Encryption Profile" (Optional).
- [x] **Storage Explorer**:
    - Indikator anzeigen (z.B. Schloss-Icon), wenn Backup verschlüsselt ist (basierend auf Meta).
    - **Download Action**:
        - Dropdown: "Download Original (.enc)" vs "Download Decrypted".
        - Bei "Decrypted": Server streamt -> Decrypt -> Browser Download.

### Phase 4: Testing
- [ ] Unit Test für `crypto-stream.ts` (Wichtig: Integritätsprüfung mit falschem AuthTag testen).
- [ ] E2E Test: Backup erstellen -> Verschlüsselt auf Disk prüfen -> Restore erfolgreich.