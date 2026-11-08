# File & Folder Backups

A backup job can collect **files and folders**, not only database dumps. Both can live in
the same job: one run produces one archive holding the databases and the directory trees
side by side.

## What this is for

The point is the word **alongside**: the configuration, the uploads directory, the certificates
and the database of one application, in one job - same schedule, same retention, same encryption
key, same restore screen. Backing an application up as a whole rather than in two tools with two
schedules is the reason this exists.

That covers config directories, an application's data folder, `wp-content`, a Grafana data
directory, a few gigabytes of user uploads.

### When to reach for something else

DBackup is **agentless**: it connects to the source, pulls the files, and writes the archive on
the DBackup host. Two consequences follow, and both scale with the size of the source:

- **A full run needs roughly twice the source size in temporary space.** The tree is staged to
  disk first, then the archive is written next to it, and neither is removed until the archive is
  complete. A 100 GB source therefore wants ~200 GB free on the DBackup host.
- **Every byte crosses the network twice** - source → DBackup → destination - because nothing runs
  on the source machine.

::: warning Running in Docker
That temporary space is the container's writable layer unless it is mounted. A job large enough can fill the Docker disk before the archive is finished. Mount `/tmp` to a volume with room to spare, or set `TMPDIR` to another mounted path, before backing up a large directory. See [Volume Mounts](/user-guide/installation#volume-mounts).
:::

Incremental mode softens the first run's cost on later runs (unchanged files are not fetched at
all and are carried into the new archive by reference), but the first full run pays it in full,
and so does every scheduled full backup after it.

There is also no content-level deduplication. Changes are tracked per file, so a large file that
changes often is stored again in full each time.

For a bulk media library, a dataset larger than the DBackup host's free disk, or anything where
deduplication is the point, use a tool built for it - [Restic](https://restic.net) and
[BorgBackup](https://www.borgbackup.org) run on the machine itself and deduplicate at block level.
They are the better answer there, and DBackup will happily keep handling the databases.

::: tip This is a deliberate trade
DBackup stores plain TAR archives so a backup can be opened without DBackup - see
[No Vendor Lock-In](/user-guide/security/recovery-kit). Restic's and Borg's repositories need
Restic and Borg. Transparency is what is bought here, and deduplication and scale are what is
paid for it.
:::

## Setting one up

1. Configure the storage adapter as a **Directory Source** under **Connections → Directory
   Sources** (an adapter is either a source or a backup destination, never both - see
   [Storage Destinations](/user-guide/destinations/) for why).
2. In the job's **Sources** tab, add the directory source and pick the folders to back up.
   A folder is read inside the folder the connection is set to. A folder that leaves it with
   `..`, also between backslashes or written as `%2e%2e`, is refused when the job is saved or
   copied, and a job that holds one from an earlier version fails its run until the folder is
   changed. `/` or an empty folder backs up the whole connection.
3. Optionally attach [Exclude Pattern Presets](/user-guide/features/templates) to skip
   caches, logs or anything else you do not want stored.

## Which adapters can do what

**Every storage adapter can be a directory source**, and
[Docker Volumes](/user-guide/sources/docker-volumes) is a source and nothing else. What
differs is how comfortable it is to configure and how a restore behaves:

| Adapter | Pick folders by browsing | Restore one file without fetching the whole archive | Symbolic links |
| :--- | :---: | :---: | :---: |
| Local Filesystem | ✅ | ✅ | ✅ |
| SFTP | ✅ | ✅ | ✅ |
| Rsync (SSH) | ✅ | ✅ | ✅ |
| FTP / FTPS | ✅ | ✅ | ⚠️ |
| WebDAV | ✅ | ✅ | — |
| Amazon S3 / S3-compatible | ✅ | ✅ | — |
| Google Drive | ✅ | ✅ | — |
| Dropbox | ✅ | ✅ | — |
| Microsoft OneDrive | ✅ | ✅ | — |
| SMB / Samba | ✅ | ❌ | — |
| Docker Volumes | ✅ volumes | n/a | ⚠️ |

A dash means the protocol has no symbolic links at all, so there is nothing to preserve.
⚠️ means links are only handled in part: FTP detects them and names them in the run log but
has no standard way to read a link's target, and a Docker volume stores them in the backup
yet cannot write them back into a volume. `n/a` marks an adapter that can only ever be a
source, so it never holds the backup the middle column describes. Docker Volumes browses
volumes rather than folders, because a volume is taken whole and there is nothing to open
inside it.

### Pick folders by browsing

Applies **while configuring a source**: DBackup queries the source server live and shows a
checkbox tree of its folders, so the path does not have to be typed from memory. Every
adapter supports it. On S3 and other object storage there are no real directories, so the
tree shows key prefixes - the same folders the provider's own console displays.

Saved connections that reach the server DBackup runs on, like a Local Filesystem or Docker Volumes without SSH, list their folders and volumes only for someone who may pick them, with `jobs:write` or `storage:restore`, and not for someone who may only see the connections.

::: info This is not the file tree you see when restoring
The tree on the restore page comes from the `.index` sidecar stored next to the backup, not
from the adapter, so **it lists every file for every adapter**. Browsing a backup never
touches the machine the files came from - that machine may not even exist any more.
:::

### Restore one file without fetching the whole archive

The column that matters for large backups. It describes the adapter holding the **backup**,
not the one being restored *to*. Adapters that can serve byte ranges fetch just the bytes of
the files you picked; SMB downloads the whole archive first and takes the files out of it
afterwards. Pulling a 5 MB file out of a 200 GB backup is a handful of small requests on S3
- and a 200 GB download on SMB.

Rsync is the odd one out: rsync itself has no concept of a partial read, but this adapter
always speaks SSH, and SFTP is a subsystem of that same server - so the range is fetched
over SFTP with the credentials already configured. If the server offers no SFTP subsystem,
the restore falls back to downloading the archive once instead of failing.

SMB is the remaining gap, and it is a limitation of the client rather than the protocol:
SMB2 reads take an offset and a length, but `smbclient` - the tool this adapter drives -
exposes no way to ask for one. Nothing is lost apart from transfer volume: file-level
restore works, it just fetches the archive first.

::: tip Source and destination are judged separately
This column only matters where backups are **written**. If your NAS is the *source* of the
files, use whatever adapter fits; if it is where backups land, prefer one that can serve
byte ranges.
:::

## Choosing an adapter

Every adapter works. Which one is *pleasant* to use for a directory source comes down to two
things: how fast it moves many files, and how it behaves when something is already there.

### What decides the speed

Not bandwidth, in most cases - **per-file overhead**. A backup of 10,000 small files spends its
time opening, authenticating and closing, not transferring. That is why the protocols separate
into two groups:

- **HTTP-based** (WebDAV, S3 and S3-compatible, Google Drive, Dropbox, OneDrive) reuse one
  connection for many requests and stream a whole file per request. There is little per-file cost
  to remove, and they are usually the quickest at scale.
- **Connection-based** (SFTP, FTP, Rsync, SMB) authenticate per connection. DBackup keeps a pool
  open per run rather than reconnecting for every file, so the login count follows the configured
  parallelism instead of the file count - but the ceiling on that parallelism is lower, because
  servers limit connections.

**Local Filesystem** has no transfer at all and is only bounded by the disk.

**Docker Volumes** sidesteps the question on the way in: a volume arrives as one stream, so
ten thousand small files cost no more round trips than one large one. A restore is the
opposite and writes file by file, which is where its parallelism setting matters.

### Parallel Transfers

Each directory source sets its own value as **Parallel transfers** in the **Speed** part of its form.
The adapter decides the range, because the sensible limit is a property of the protocol:

| Adapter | Default | Maximum | Why the ceiling is where it is |
| :--- | :---: | :---: | :--- |
| SFTP, Rsync (SSH) | 4 | 8 | Every transfer is an SSH login, and OpenSSH refuses connections past `MaxStartups` - ten at once by default. Eight leaves room for your own session. |
| FTP / FTPS | 2 | 4 | Each transfer needs a control **and** a data connection, and servers commonly cap connections per address at around five. |
| Dropbox | 4 | 4 | Dropbox throttles concurrent writes per account. Above four the time goes into retries, so the default is also the limit. |
| Docker Volumes | 4 | 8 | Only the restore uses it, since a volume is *read* as one stream. Writing it back is one daemon request per file, and over SSH without socket forwarding each request starts a Docker CLI process on the target. |
| Everything else | 4 | 16 | No protocol-level reason to stay lower. |

Raising it helps most when the files are small and the link has latency. It helps least when one
large file dominates - a single transfer already fills a fast link on its own.

### Exclude patterns, and why they are worth setting

Before anything is transferred, the source tree has to be listed. On a connection-based adapter
that is one round trip per **directory**, so a tree with thousands of folders spends real time
here before the first byte moves. A `node_modules`, a `.git` or a package cache can easily be the
majority of that.

Exclude patterns are what avoid it. On SFTP, a pattern that excludes everything below a folder
makes the walk skip that folder entirely rather than list it and throw the result away. The run
reports what it skipped, so nothing disappears quietly:

```
48,213 file(s) skipped by exclude patterns (2.1 GB), plus 14 director(ies) not scanned at all
```

The distinction that decides whether a folder is skipped is the pattern's shape:

| Pattern | Effect |
| :--- | :--- |
| `node_modules/**` | Excludes everything inside, so the folder is never listed. |
| `**/node_modules/**` | Same, at any depth. |
| `node_modules` | Excludes **nothing**. A pattern without a slash matches file names, and no file is named `node_modules`. |
| `*.log` | Excludes log files wherever they are. Folders are still listed, because they hold other files too. |

The third row is the one that catches people out. Write `node_modules/**`, not `node_modules`.

Attach patterns per source under **Connections → Directory sources**, or reuse a set across jobs
with [Exclude Pattern Presets](/user-guide/features/templates). The groups of DBackup a preset
follows write their folders as `**/node_modules/**`, so they skip them at any depth.

### While it runs

The progress display names what it is doing rather than going quiet during the slow parts. A run
reports `scanning, 12,480 file(s) in 1,200 director(ies)` while it walks the tree, then per-file
counts while it transfers, then the hashing and packing steps. **Cancel** takes effect during any
of them, within about one round trip.

### Behaviour worth choosing on

**Rsync restores only what differs.** Restoring to an Rsync destination compares each file against
what is already there and sends only the differing blocks, so restoring over an existing copy can
finish with almost no traffic. No other adapter does this. It is a comparison, not a skip: every
file is checked, so a file that was damaged is still repaired.

**Rsync as a *source* lists the whole tree on every run.** The listing is one `find` over SSH and
is fast, but an incremental run has to see every file to decide what changed. Only the changed
files are then transferred, in a single native sync.

**SMB cannot restore a single file cheaply.** It is the one adapter without ranged reads, so
restoring one file out of a large archive fetches the archive once. See the table above.

::: info About numbers
Throughput figures depend entirely on the link, the server and the files, so this page gives none.
As one data point from a single setup - a Mac over Tailscale to a Synology NAS, 1 GB across 125
mostly-large files - SFTP and WebDAV both reached triple-digit MB/s, Rsync about half that. Your
own numbers will differ; the ranking above is the part that carries over.
:::

## What ends up in the archive

Every backup uses the seekable archive format, and directory backups are no exception: each file is compressed and encrypted on its own, and an index sidecar lists every path, size, timestamp and checksum. That is what makes browsing a backup cheap - listing an archive reads a few megabytes whatever its size - and what makes restoring one file out of it possible. Database dumps of the same job sit in the same archive as entries of their own.

Because compression is decided per file, formats that are already compressed - video,
photos, archives, Office documents - are stored as-is rather than packed a second time for
nothing. They are still fully in the backup. The
[full list of formats](/user-guide/security/compression#formats-stored-as-is) is in the
compression guide.

An unencrypted archive is a plain TAR: `tar -xf backup.tar` works with no DBackup involved.
An encrypted one needs the [Recovery Kit](/user-guide/security/recovery-kit), which reads
it with nothing but Node.js. The layout is specified byte by byte in the
[Archive Format reference](/developer-guide/reference/archive-format).

### Symbolic links

Symbolic links are backed up **as links**, with their target stored exactly as it was
written. A relative target stays relative, so it still points at the right place after a
restore.

The file a link points at is **not** pulled into the backup on its own account. It is
included only if it happens to sit inside the source folder anyway. This is what makes a
Let's Encrypt directory restore correctly: `live/` holds the links, `archive/` holds the real
certificates, and backing up the parent folder captures both in their original relationship.

A link that points outside the source is stored as the link it is, pointing where it always
pointed. Nothing from outside the folder you selected is ever collected.

Two consequences worth knowing:

- **A link to a folder is stored as a link, not followed.** The folder's contents are backed
  up only if that folder is itself inside the source. This matches how `tar` and `rsync -a`
  behave. The run log names every folder link it stored, so a source that is mostly links to
  data living elsewhere does not look bigger than it is.
- **Restoring to object storage cannot recreate them.** S3, Google Drive, OneDrive, Dropbox
  and WebDAV have no symbolic links. Such a restore names every link it had to skip and
  finishes as *Partial* rather than reporting a success it did not deliver. Restoring to a
  local path, over SFTP, or as a `.tar.gz` download recreates them properly.
- **A restore lays no link that leads out of the folder it writes into.** A link whose
  target is absolute, like `/etc/ssl/cert.pem`, or climbs above that folder with `..` is
  skipped and named in the log of the restore, which finishes as *Partial*. So is a target
  with a `..` after a folder, like `up/../secret`, since `up` may itself be a link that
  leads elsewhere, and a target that runs through another link of the same backup. A `..`
  at the start, like `../../archive/cert.pem`, is fine. Once laid, such a
  link would lead the next backup, restore or browse that follows it to any file of the
  server. It is skipped rather than written as a plain file, which would claim to be
  something it never was. A `.tar.gz` download keeps every link as it was, and a relative
  link that stays inside the folder, like the ones of Let's Encrypt, is restored as before.

### Names that cannot be a file of the folder

Every name of a source comes from its server, which may answer anything. A name that cannot
be a file of the folder you picked is left out of the backup and named in the run log, and the
run finishes as *Partial*. That covers a name with a `..` or `.` part, also one written with
backslashes, an absolute path, an empty name, a name with a NUL character and one that ends in
a separator.

What arrives for a name is checked too. DBackup reads a collected file only as a regular file
inside the folder of the run, never through a symbolic link, so a file that arrives as a link,
a device, a pipe or a socket, or below a folder that arrives as a link leading out of the run,
is left out and named the same way. A symbolic link the listing reports as one is still backed
up as a link.

### Limits of a source

The listing of a source is held in memory until its files are collected, so a source fails with a
message that names the limit when it lists **more than 10 million entries**, a path or link
target **longer than 32 KB**, far past what a file system allows, or paths and link targets that
add up to **more than 2 GB**, the most the index of one backup holds. The answer of a server for
one folder is bounded as well, **256 MB** for WebDAV and **40 MB** for FTP. Back up the subfolders
of such a tree as separate sources. A file is recorded with the size it arrived with, so one that grew
between the listing and the transfer restores whole. A small file that grew past 64 KB after it
was collected, while the archive was written, is left out and named in the run log, and the run
finishes as *Partial*.

File permissions and ownership are not yet preserved. A restored file gets default
permissions, so anything relying on a restrictive mode (a private key at `0600`) needs it set
again after a restore.

## Restoring

The restore page shows a file tree per directory source. Restore everything, a single
folder, or individual files - each source with its own target:

- back to the **original location** it was collected from
- into any other configured destination
- as a **`.tar.gz` download** to your own machine

A backup that holds databases *and* files asks which half you want before opening the page.

Some targets and files are refused, the rest of the restore goes on:

- **A target folder that leaves the connection** with `..`, or with a part a storage reads as one like `%2e%2e` or `.. `, is refused before anything is written.
- **Another place than the original location** needs the right to change the connection the files go to, `destinations:write` in its tenant, besides the right to restore. A restore there overwrites whatever lies in that folder, like the backups of other jobs. A folder inside the original location counts as the original location. A connection that reaches the server DBackup runs on, like Local Filesystem, takes a platform admin signed in with a session in the home tenant for any other folder.
- **A `.meta.json`** decides how DBackup reads the backup beside it, whether retention keeps it and whether it is locked, **a file named like a backup or its index** (`.tar`, `.enc`, `.index`) would replace a backup on a backup destination (into a folder a job backs up it restores like any file), and **a file in a `config-backups` folder or named `config_backup_*`** reads as a configuration backup. Only a platform admin signed in with a session restores those into a storage, for everyone else they are listed as failed. A `.tar.gz` download holds them as usual. Each name counts up to its first `:`, which Windows reads as the start of an alternate data stream, so `x.meta.json::$DATA` is a `.meta.json` too, and names compare without case, so `X.Meta.Json` is one as well.
- **Into an SMB share** a file with a `:` in its path is listed as failed for everyone, since the share would write it into a stream of another file, and so is one with a semicolon, a double quote or a control character, which `smbclient` cannot take, see [SMB / CIFS](/user-guide/destinations/smb#how-it-works). A file with a part like `CONFIG~1` in its path, which Windows may read as the short name of another file or folder, is listed as failed there unless a platform admin restores it.
- **A file or link below a symbolic link that leads out of the target folder**, laid by an earlier restore or by anything else, is listed as failed, since it would land elsewhere on the destination. On a local path DBackup follows the links of the path and refuses one that ends outside the target folder. Over SFTP a file follows a link below the target folder only when the server resolves it to a folder inside, and a link of the restore is laid below no link at all. A file over SFTP never goes through a link at its own name either. The link is replaced by the file, and a file it replaces hands on its mode and, where the login may set it, its owner.
- **Docker Volumes** have rules of their own, see [Docker Volumes](/user-guide/sources/docker-volumes#restoring).

A restore into a storage stages each file in the temporary folder of DBackup before it uploads it. Before the first file, it checks that the largest files that run at once fit the free space there, with 512 MB kept back, and refuses with a message otherwise. A restore of a database checks the same for its largest dump. A compressed whole-file backup, written before the seekable archive, inflates only as far as the space it was promised and fails with the same message beyond it.

## Incremental

Directory sources can be backed up incrementally, storing only what changed since the last
run. See [Backup Modes](/user-guide/features/backup-modes) for how chains are stored, what
forces a full backup, and how retention treats them.

Every source type takes part, Rsync included: an Rsync source transfers the changed files in one
native sync and references the rest from the earlier backups of the chain.

## Shadow copies (SMB)

Backing up a live share means reading a tree that keeps changing. For shares holding
running applications, SMB sources can read from a VSS snapshot instead - see
[SMB / CIFS](/user-guide/destinations/smb).

## Next Steps

- [Backup Modes](/user-guide/features/backup-modes) - full vs incremental
- [Restore](/user-guide/features/restore) - the full restore flow
- [Recovery Kit](/user-guide/security/recovery-kit) - getting data back without DBackup
