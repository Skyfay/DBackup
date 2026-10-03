/**
 * Builds the Recovery Kit: the zip a user keeps so their backups outlive DBackup.
 *
 * Everything here is written for someone who is having a bad day and has never read this
 * documentation before. That is why the kit is one tool rather than a choice of scripts,
 * why the launchers exist, and why every instruction also gives the plain terminal command
 * that works when a launcher does not.
 */

import AdmZip from "adm-zip";
import fs from "fs/promises";
import path from "path";
import { logger } from "@/lib/logging/logger";
import { ValidationError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ service: "RecoveryKitService" });

/** The single standalone tool shipped in the kit. Lives in scripts/ and is tested there. */
export const RECOVERY_TOOL = "dbackup-recover.js";

/**
 * Unix mode for the files that need to be runnable, so they arrive that way.
 *
 * A plain mode, not a pre-shifted external-attributes value: AdmZip masks what it is given
 * with `0xfff` and does the shifting and the file-type bit itself. Handing it an already
 * shifted value silently produces mode 000 - a file macOS refuses to open at all, with a
 * permissions error that reads like a broken machine rather than a broken archive.
 */
export const EXECUTABLE_MODE = 0o755;

/**
 * Starts the tool from wherever the kit was unpacked.
 *
 * `cd` first, because a double-click on macOS opens Terminal in the home directory, and the
 * tool looks for master.key and for backups next to itself.
 */
function unixLauncher(): string {
    return `#!/bin/sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is required but was not found."
    echo "Install it from https://nodejs.org/ (version 18 or newer), then run this again."
    printf "Press Enter to close..."
    read -r _
    exit 1
fi

node ${RECOVERY_TOOL}

printf "\\nPress Enter to close..."
read -r _
`;
}

function windowsLauncher(): string {
    return `@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required but was not found.
    echo Install it from https://nodejs.org/ ^(version 18 or newer^), then run this again.
    pause
    exit /b 1
)

node ${RECOVERY_TOOL}

pause
`;
}

function readme(profiles: RecoveryKitProfile[], generatedAt: string): string {
    const single = profiles.length === 1;
    const heading = single
        ? `# Recovery Kit for Profile: ${profiles[0].name}`
        : `# Recovery Kit for ${profiles.length} Encryption Profiles`;

    // Spelled out rather than counted: in a recovery, knowing which profiles a kit covers
    // is the difference between "this is the right one" and trying all of them.
    const covers = single ? "" : `
Covers these profiles:
${profiles.map((profile) => `  - ${profile.name}`).join("\n")}

The tool picks the right key for each backup by itself, from the profile the backup
records. Nothing needs choosing.
`;

    // The id the backups name, so importing the key from this kit into another Vault counts them
    // under it. A kit with several keys lists theirs in keys/keys.json.
    const id = single ? `Profile ID: ${profiles[0].id}\n` : "";

    return `${heading}
Generated at: ${generatedAt}
${id}${covers}
This kit restores your backups WITHOUT DBackup. Keep it somewhere safe, and NOT next to
your backups - it contains the ${single ? "key" : "keys"} that open them.


## HOW TO USE IT

1. Unzip this kit into a folder.

2. Copy the backup into that same folder. If the backup is a FOLDER (an incremental
   chain), copy the whole folder.

3. Start the tool. Two ways, both fine - use the second if the first is blocked:

   THE EASY WAY - double-click a launcher

       Windows      START-Windows.bat
       macOS        START-macOS.command
       Linux        START-Linux.sh

       macOS refuses the first launch of anything downloaded from the internet, with
       "Apple could not verify START-macOS.command is free of malware". To allow it:

         1. Click Done on that dialog.
         2. Open System Settings > Privacy & Security and scroll to Security.
         3. Next to "START-macOS.command was blocked", click Open Anyway.
         4. Confirm with Touch ID or your password, then Open Anyway once more.

       After that it starts normally. On macOS 14 and older, right-clicking the file and
       choosing Open does the same thing in one step.

       If that is more trouble than it is worth, use the terminal below - it is not
       affected by any of this.

   THE WAY THAT ALWAYS WORKS - a terminal

       Open a terminal:
         Windows    Start menu -> type "cmd" -> Command Prompt
         macOS      Applications -> Utilities -> Terminal
         Linux      your terminal application, or Ctrl+Alt+T

       Go to this folder. Type "cd " (with the space) and then drag this folder from
       your file manager onto the terminal window - it fills in the path for you.
       Press Enter. Or type it out:

         cd /path/to/this/folder

       Then run:

         node ${RECOVERY_TOOL}

4. It shows what it found and asks what to do with it. That is all.

You do not need to know which kind of backup you have, and you do not need to type a key
anywhere: the tool reads ${single ? "master.key" : "the keys/ folder"} from here by itself.


## PREREQUISITES

Node.js 18 or newer, from https://nodejs.org/
Nothing else - no npm install, no DBackup server, no database.

To check whether you already have it, run "node --version" in a terminal.


## CONTENTS

${single
        ? "  master.key            Your raw 64-character key. Anyone holding it can read your backups."
        : "  keys/                 One key per profile, named after it, plus an index tying each\n" +
          "                        one to the backups it opens. Anyone holding these can read\n" +
          "                        every backup made with any of these profiles."}
  ${RECOVERY_TOOL}   The recovery tool. Reads every backup format DBackup writes.
  START-Windows.bat     Double-click launcher for Windows.
  START-macOS.command   Double-click launcher for macOS.
  START-Linux.sh        Launcher for Linux.
  README.txt            This file.


## INCREMENTAL BACKUPS

A job with incremental backups stores each chain in its own folder:

    MyJob/chain-2026-07-24T03-00-00-000/
        ..._full-000.tar     the full backup the chain is built on
        ..._inc-001.tar      what changed after it
        ..._inc-002.tar      what changed after that

Copy that whole folder. The tool picks the newest snapshot on its own and rebuilds the
current state from all of them, every file at its latest version. Pick "an older state" in
the menu to go back to an earlier point instead.

If an archive of the chain is missing, the tool names it and stops rather than writing an
incomplete restore.


## COMMAND LINE

The same tool, for scripting or over SSH. Everything lands in ./restored unless another
folder is named.

    node ${RECOVERY_TOOL} --list    <archive or folder>
    node ${RECOVERY_TOOL} --extract <archive or folder> <output_dir> [pattern...]
    node ${RECOVERY_TOOL} --decrypt <backup.enc> [output_dir] [database...]

Patterns accept * and **, and naming a folder takes everything inside it:

    node ${RECOVERY_TOOL} --extract backup.tar ./restored 'www/**'
    node ${RECOVERY_TOOL} --extract backup.tar ./restored docs

To restore a single database out of a backup that holds several, name it. Run --list first
to see which ones there are:

    node ${RECOVERY_TOOL} --decrypt AllDbs.tar.enc ./restored shop
    node ${RECOVERY_TOOL} --extract backup.tar ./restored databases/shop

Every extracted file is checked against the checksum recorded when the backup was made.
A key can be passed as an extra argument if this folder has none.


## WITHOUT THIS KIT AT ALL

An UNENCRYPTED file backup is a plain TAR:

    tar -xf backup.tar

If the job used compression, look at the names: anything ending in '.gz' or '.br' is a
compressed stream - run 'gunzip' or 'brotli -d' on it. Everything else is already the real
file. Formats that are compressed to begin with, such as videos and photos, are stored
as-is and come out ready to use. Encrypted backups always need this kit.
`;
}

/** One encryption profile going into a kit. */
export interface RecoveryKitProfile {
    id: string;
    name: string;
    /** The profile's raw 64-character master key. */
    masterKeyHex: string;
}

export interface RecoveryKitInput {
    profiles: RecoveryKitProfile[];
    /** Stamped into the README. Injected so the output is reproducible in tests. */
    generatedAt?: string;
}

/** Index of a multi-key kit, so the tool can go straight from a backup to its key. */
export const KEYS_INDEX = "keys/keys.json";

/**
 * Turns a profile name into something safe to use as a filename, keeping it recognisable.
 *
 * The name is what the person reads when they open the folder, so a key called "Production"
 * should not arrive as `key-2.key`.
 */
function keyFileName(name: string, taken: Set<string>): string {
    const base = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "key";
    let candidate = `${base}.key`;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base}-${n}.key`;
    taken.add(candidate.toLowerCase());
    return candidate;
}

/**
 * Assembles the kit. Returns the zip bytes, ready to send.
 *
 * A single profile produces the familiar `master.key`. Several produce a `keys/` folder,
 * one file per profile named after it, plus an index mapping each backup's recorded profile
 * id to its key - which is what lets the tool pick the right one instead of trying them.
 */
export async function buildRecoveryKit({
    profiles,
    generatedAt = new Date().toISOString(),
}: RecoveryKitInput): Promise<Buffer> {
    if (profiles.length === 0) {
        throw new ValidationError("A Recovery Kit needs at least one encryption profile.", { field: "profiles" });
    }

    const zip = new AdmZip();

    // The tool reads these itself, which is why no launcher carries a key: a key passed as
    // an argument shows up in shell history and in the process list.
    if (profiles.length === 1) {
        zip.addFile("master.key", Buffer.from(profiles[0].masterKeyHex, "utf8"));
    } else {
        const taken = new Set<string>();
        const index = profiles.map((profile) => {
            const file = keyFileName(profile.name, taken);
            zip.addFile(`keys/${file}`, Buffer.from(profile.masterKeyHex, "utf8"));
            return { profileId: profile.id, name: profile.name, file };
        });
        zip.addFile(KEYS_INDEX, Buffer.from(JSON.stringify({ version: 1, keys: index }, null, 2), "utf8"));
    }

    // One file, deliberately. It is unzipped into a strange folder in the worst week of
    // someone's year, and anything that can be separated from it by a careless copy
    // eventually will be. It recognises every backup format DBackup writes, so nobody has
    // to work out which one they are holding before they can start.
    try {
        const toolContent = await fs.readFile(path.join(process.cwd(), "scripts", RECOVERY_TOOL), "utf8");
        zip.addFile(RECOVERY_TOOL, Buffer.from(toolContent, "utf8"), "", EXECUTABLE_MODE);
    } catch (e: unknown) {
        log.error("Failed to read the recovery tool", { script: RECOVERY_TOOL }, wrapError(e));
        zip.addFile(
            `ERROR_MISSING_${RECOVERY_TOOL}.txt`,
            Buffer.from(`Could not find scripts/${RECOVERY_TOOL} on server.`, "utf8")
        );
    }

    // One launcher per platform, so the tool can be started by double-clicking. None takes
    // an argument and none carries a key - they only start it, and it asks the rest.
    zip.addFile("START-Windows.bat", Buffer.from(windowsLauncher(), "utf8"));
    // A .command file is what macOS opens in Terminal on a double-click.
    zip.addFile("START-macOS.command", Buffer.from(unixLauncher(), "utf8"), "", EXECUTABLE_MODE);
    zip.addFile("START-Linux.sh", Buffer.from(unixLauncher(), "utf8"), "", EXECUTABLE_MODE);

    zip.addFile("README.txt", Buffer.from(readme(profiles, generatedAt), "utf8"));

    return zip.toBuffer();
}
