# Recovery Kit

Emergency decryption tool for encrypted backups.

## Overview

A Recovery Kit is a standalone package that lets you decrypt backups **without access to DBackup**. It's essential for disaster recovery scenarios.

## What's Included

Each Recovery Kit contains:

```
recovery-kit/
├── README.txt              # Instructions
├── master.key              # Your encryption key (64 hex characters)
├── dbackup-recover.js      # The recovery tool
├── START-Windows.bat       # Double-click launcher
├── START-macOS.command     # Double-click launcher
└── START-Linux.sh          # Launcher
```

A kit covering several profiles carries a `keys/` folder instead of `master.key`, with one
file per profile named after it and an index tying each key to the backups it opens:

```
recovery-kit/
├── keys/
│   ├── Production.key
│   ├── Legacy-2024.key
│   └── keys.json           # which key opens which backups
└── ...
```

One tool handles every backup format DBackup writes - database dumps, file backups and
incremental chains, encrypted or not. It works out which one it is looking at, so you do
not have to, and everything it restores lands in a `restored` folder ready to use.

It streams every entry it extracts, so a backup containing a 50 GB VM image needs no more
memory than one containing text files - which matters precisely when you are recovering
onto whatever machine happens to be available. Files are written to a temporary name and
only put in place once their authentication tag and recorded checksum both verify, so a
damaged archive never leaves something that looks like a recovered file.

## Why You Need It

### Disaster Scenarios

- DBackup server destroyed
- Database corrupted
- Lost access to application
- `ENCRYPTION_KEY` lost
- Need offline access

### Without Recovery Kit

❌ Cannot decrypt backups
❌ Data potentially lost forever
❌ No way to recover encryption key

### With Recovery Kit

✅ Decrypt backups anywhere
✅ Only need Node.js
✅ Works offline
✅ Independent of DBackup

## Downloading a Recovery Kit

1. Go to **Settings** → **Vault**
2. Click **Recovery Kit**
3. Tick the encryption profiles the kit should carry - everything is ticked by default
4. Click **Download** and save the zip securely

One kit can hold several keys. That is usually what you want: a backup records which
profile encrypted it, so the tool picks the right key by itself and you never have to work
out which of your kits belongs to which job. Untick profiles when you need a kit that only
opens part of your backups - handing one to someone who should not see everything, for
instance.

::: danger A multi-key kit opens everything
A kit with one key exposes one profile's backups if it leaks. A kit with all of them
exposes all of them. Weigh that against the convenience before you store it somewhere less
protected than your backups are.
:::

::: danger Store Securely
The Recovery Kit contains your encryption key! Store it:
- In a password manager
- On encrypted storage
- In a secure physical location
- **NOT** in the same place as backups
:::

## Using the Recovery Kit

The only prerequisite is [Node.js 18 or newer](https://nodejs.org/). No `npm install`, no
DBackup server, no database.

1. Unzip the Recovery Kit.
2. Copy the backup next to the unzipped files. If the backup is a **folder** - which is how
   an incremental chain is stored - copy the whole folder.
3. Start the tool. Double-clicking a launcher is the quick way:

   | System | Launcher |
   | :--- | :--- |
   | Windows | `START-Windows.bat` |
   | macOS | `START-macOS.command` |
   | Linux | `START-Linux.sh` |

   If a launcher is blocked or does nothing, open a terminal instead - this always works,
   on every system:

   ```bash
   cd /path/to/the/unzipped/kit
   node dbackup-recover.js
   ```

   To open a terminal: **Windows** Start menu, type `cmd`. **macOS** Applications →
   Utilities → Terminal. **Linux** your terminal application, or <kbd>Ctrl</kbd> +
   <kbd>Alt</kbd> + <kbd>T</kbd>. Instead of typing the path, type `cd ` and then drag the
   kit's folder onto the terminal window.

4. It shows what it found and asks what to do with it:

```
  DBackup Recovery
  Key loaded from master.key

  Found 2 backup(s):

 > chain-2026-07-25T20-10-37-652   25.07.2026 20:11  1.0 GB  encrypted  incremental chain, 2 archive(s)
   MyDb_2026-07-20.sql.gz.enc      20.07.2026 03:00  348 MB  encrypted
   Quit
```

Choosing a backup offers restoring everything, looking inside first, picking an older state
of a chain, or restoring only part of it - certain files, or certain databases by name.

You never have to type the key: the tool reads `master.key` from its own folder. If the key
is somewhere else, it asks for it.

::: tip macOS blocks the launcher on its first run
Anything downloaded from the internet is quarantined, so the first double-click is refused
with *"Apple could not verify START-macOS.command is free of malware"*. Click **Done**, then
open **System Settings → Privacy & Security**, scroll to **Security**, and click **Open
Anyway** next to the blocked file. Confirm with Touch ID or your password, then **Open
Anyway** once more. It starts normally from then on.

On macOS 14 and older, right-clicking the file and choosing **Open** does the same in one
step. Either way, the terminal command above is unaffected by this.
:::

## Command line

The same tool, for scripting or over SSH. Every mode accepts a folder wherever it accepts
an archive.

```bash
node dbackup-recover.js --list    <archive or folder>
node dbackup-recover.js --extract <archive or folder> <output_dir> [pattern...]
node dbackup-recover.js --decrypt <backup.enc> [output_dir] [database...]
```

Everything lands in `./restored` unless another folder is named.

`--list` prints the databases, the directory sources, and every file with its size and
modification time. For an incremental snapshot it also names every archive the snapshot
needs and marks any that are missing, so a gap is visible before you start extracting.

`--extract` patterns accept `*` and `**`, and naming a folder selects everything inside it:

```bash
node dbackup-recover.js --extract backup.tar ./restored 'www/**'
node dbackup-recover.js --extract backup.tar ./restored docs
```

Every extracted file and database dump is verified against the checksum recorded when the backup was made. A mismatch is reported, the file is not written, and the command exits non-zero. Dump checksums exist in backups written since every job became a seekable archive, and only a recently downloaded kit checks them, so download the kit again after updating DBackup.

`--decrypt` handles a database backup written by an earlier version, encrypted as a single file. It decompresses in the
same pass, and a backup holding several databases is unpacked into one dump per database -
the output is always ready to feed to `mysql`, `psql` or `mongorestore`, never a `.gz` or a
`.tar` to take apart first.

### Restoring a single database

Name it, and nothing else is written. Which form you use depends on where the database
lives, and `--list` tells you which databases a backup contains:

```bash
# Any backup written by a current version, addressed under the databases/ prefix
node dbackup-recover.js --extract backup.tar ./restored databases/shop

# A database-only backup written by an earlier version (a .tar of dumps, encrypted as a whole)
node dbackup-recover.js --decrypt AllDbs.tar.enc ./restored shop
```

Naming a database in the first form also keeps the archive's directory sources and every other database out of the restore, so you get the dump on its own. A database whose name contains `/` or `\` is written with those characters replaced by `_`.

The key is read from `master.key` next to the tool. Pass it as an extra argument to override,
or leave it out entirely for unencrypted backups.

## Incremental chains

An incremental backup is stored as a chain in one folder: one full backup plus the changes
made after it.

```
MyJob/chain-2026-07-24T03-00-00-000/
    ..._full-000.tar     the full backup the chain is built on
    ..._inc-001.tar      what changed after it
    ..._inc-002.tar      what changed after that
```

**Copy the whole folder and point the tool at it.** It picks the newest snapshot on its own
and rebuilds the current state from all of them, every file at its latest version, merged
into a single output folder. There is no separate step to replay the chain.

```bash
node dbackup-recover.js --extract ./chain-2026-07-24T03-00-00-000 ./restored
```

To recover an older state, choose "Pick an older state" in the wizard, or name that archive
directly - each one rebuilds the snapshot as it was at its own point in time.

Keep the archives of a chain together in one folder; that is how they find each other. A
missing archive aborts the extract by name instead of writing an incomplete restore.

::: tip Unencrypted archives need no kit at all
If the job had no encryption profile, the archive is a plain TAR:

```bash
tar -xf backup.tar
# If the job used compression, the extracted files are gzip streams:
find . -name '*.gz' -exec gunzip {} +
```

Encrypted archives always require this kit, because each file inside is individually
encrypted.
:::

## How It Works

There are two shapes of backup, and the tool tells them apart on its own. What follows is only needed if you want to write your own recovery code.

### Backups written by earlier versions for database-only jobs

One stream: the dump, optionally compressed, optionally encrypted with AES-256-GCM as a
whole. Everything needed to open it apart from the key is in the `.meta.json` next to it.

```json
{
  "compression": "GZIP",
  "encryption": {
    "enabled": true,
    "iv": "hex-encoded-initialization-vector",
    "authTag": "hex-encoded-authentication-tag"
  }
}
```

Decrypt with the IV and authentication tag from that file, then decompress. A job backing
up several databases produces a TAR of dumps, so unpack that afterwards as well.

### Seekable archives

Every backup written by a current version, whether it holds databases, files or both. It encrypts each entry separately, which is what makes it possible to pull one file or one database out of a large backup. It is a different job entirely, specified byte by byte in the [Archive Format reference](/developer-guide/reference/archive-format).

::: warning
The single-stream approach below does **not** work on a seekable archive. Decrypting it as one
blob produces nothing usable - use the Recovery Kit, or implement the format from that
reference.
:::

## Best Practices

### Storage Recommendations

| Location | Security | Accessibility |
| :--- | :--- | :--- |
| Password Manager | ✅ High | ✅ Easy |
| Encrypted USB | ✅ High | ⚡ Medium |
| Bank Safe Deposit | ✅ Very High | ❌ Difficult |
| Printed (sealed) | ✅ High | ❌ Manual entry |

### Multiple Copies

Store Recovery Kit in:
1. Primary: Password manager (Bitwarden, 1Password)
2. Secondary: Encrypted USB at home
3. Tertiary: Sealed envelope at trusted location

### Test Regularly

1. Download a fresh Recovery Kit quarterly
2. Actually run it against a recent backup - unzip it somewhere, copy a backup next to it,
   start it and check the restored files. It takes a minute, and it is the only way to know
   the kit, the key and the backup all still line up.
3. Re-download after any change to the profile

### Update After Key Rotation

When creating new encryption profile:
1. Download new Recovery Kit
2. Update all storage locations
3. Keep old kit until old backups expire

## Troubleshooting

### macOS: "You do not have permission to open the document"

The launcher lost its executable bit. Kits generated before v3 all have this. Download the
kit again, or run it from a terminal instead:

```bash
cd /path/to/the/kit
node dbackup-recover.js
```

### macOS: "Apple could not verify ... is free of malware"

Gatekeeper quarantines anything downloaded from the internet. The dialog only offers *Move
to Trash* and *Done* - the approval lives elsewhere:

1. Click **Done**.
2. **System Settings → Privacy & Security**, scroll to **Security**.
3. **Open Anyway** next to `START-macOS.command`, confirm, then **Open Anyway** again.

macOS 14 and older allow the shortcut of right-clicking the file and choosing **Open**.
Apple removed that in macOS 15. Running `node dbackup-recover.js` from a terminal avoids the
whole thing.

### "Decryption failed. Either the key is wrong or the backup is damaged."

The key in this folder does not open this backup. Each encryption profile has its own key,
so check you have the kit for the profile the job used - the backup's `.meta.json` names it
under `encryption.profileId`. Downloading a kit that covers every profile avoids the
question entirely. If the key is right, the backup file itself is damaged and needs
downloading again.

A kit with several keys reports this as *"None of the N keys in this kit open ..."* and
lists what it tried.

The same cause reads as `Authentication failed for entry N` on a file backup, which
verifies each entry separately.

### "No metadata found at ...meta.json"

The `.meta.json` sidecar holds the IV and authentication tag, so a backup cannot be
decrypted without it. Copy it from the backup destination alongside the backup itself - it
sits right next to it.

### "This backup is part of an incremental chain and N archive(s) it needs are missing"

An incremental snapshot reads files out of the earlier archives of its chain. Copy the
whole `chain-...` folder rather than a single `.tar` from inside it. The message names the
archives it could not find, and `--list` shows the full set a snapshot depends on.

## Decrypting Without Node.js

Only for database-only backups written by earlier versions. A seekable archive needs the archive format, see above.

### Python

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import gzip, json

key = bytes.fromhex(open('master.key').read().strip())
meta = json.load(open('backup.sql.gz.enc.meta.json'))

iv = bytes.fromhex(meta['encryption']['iv'])
tag = bytes.fromhex(meta['encryption']['authTag'])
encrypted = open('backup.sql.gz.enc', 'rb').read()

# The tag is appended to the ciphertext for AESGCM.decrypt()
plain = AESGCM(key).decrypt(iv, encrypted + tag, None)

if meta.get('compression') == 'GZIP':
    plain = gzip.decompress(plain)

open('backup.sql', 'wb').write(plain)
```

::: warning Not with the `openssl` command line
`openssl enc` cannot verify a GCM authentication tag, so it either refuses these files or
produces unverified output. Use a real AES-GCM implementation - the Python snippet above,
or the Recovery Kit.
:::

## Emergency Checklist

When you need to use Recovery Kit:

- [ ] Locate the Recovery Kit
- [ ] Download the backup, including its `.meta.json` - and the whole folder if it is an incremental chain
- [ ] Install Node.js if needed
- [ ] Unzip the Recovery Kit
- [ ] Copy the backup into the same folder
- [ ] Start the launcher, or `node dbackup-recover.js` in a terminal there
- [ ] Follow the prompts, then check the files under `restored/`
- [ ] Restore to database

## Next Steps

- [Encryption Vault](/user-guide/security/encryption) - Manage encryption profiles
- [Restore](/user-guide/features/restore) - Normal restore process
- [System Backup](/user-guide/features/system-backup) - Backup DBackup itself
