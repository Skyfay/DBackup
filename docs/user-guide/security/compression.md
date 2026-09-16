# Compression

Reduce backup file sizes with Gzip or Brotli compression.

## Overview

Compression significantly reduces:
- **Storage costs** - Smaller files = less storage
- **Transfer time** - Less data to upload
- **Network bandwidth** - Lower bandwidth usage

Typical compression ratios for SQL dumps:

| Content Type | Compression Ratio |
| :--- | :--- |
| SQL dumps (text) | 60-80% smaller |
| Binary data (BLOBs) | 10-30% smaller |
| Already compressed | 0-5% smaller |

## Compression Algorithms

### Gzip

**Best for**: General use, fast compression

| Aspect | Rating |
| :--- | :--- |
| Speed | ⭐⭐⭐⭐⭐ Fast |
| Compression | ⭐⭐⭐ Good |
| CPU Usage | Low |
| Compatibility | Universal |

### Brotli

**Best for**: Maximum compression, slower systems acceptable

| Aspect | Rating |
| :--- | :--- |
| Speed | ⭐⭐⭐ Moderate |
| Compression | ⭐⭐⭐⭐⭐ Excellent |
| CPU Usage | Medium |
| Compatibility | Modern |

DBackup runs Brotli at quality 10 rather than its maximum of 11. On a measured 22 MB SQL
dump that costs 2.5% in size and returns well over half the time. Quality 9 and below are a
different setting rather than a faster version of the same one - they skip the search that
makes Brotli worth choosing, and produce output around 85% larger. If that trade appeals,
Gzip already offers it.

### Comparison

Indicative figures for a 100 MB SQL dump. Your ratio depends entirely on the content, and
Brotli's lead over Gzip grows the more repetition there is:

| Algorithm | Compressed Size | Relative Time |
| :--- | :--- | :--- |
| None | 100 MB | - |
| Gzip | 25 MB (75% reduction) | 1x |
| Brotli | 20 MB (80% reduction) | 15-25x |

## Enabling Compression

### On Job Creation

1. Create or edit a backup job
2. In **Processing** section, enable **Compression**
3. Select algorithm: **Gzip** or **Brotli**
4. Save

### File Extensions

Every backup is a seekable archive that compresses each database dump and each file on its own, so the archive keeps its `.tar` name. In an unencrypted archive the entries carry the extension instead, for example `databases/shop.sql.gz`.

Backups written by earlier versions for database-only jobs are compressed as a whole and have extensions:
- Gzip: `backup.sql.gz`
- Brotli: `backup.sql.br`

With encryption:
- `backup.sql.gz.enc`
- `backup.sql.br.enc`

## Already-Compressed Formats

Every file of a directory source is compressed on its own. Files whose format is already compressed are stored as-is instead, even when the job has compression enabled. The same goes for database dumps the engine already compressed: PostgreSQL custom-format dumps with compression on, MongoDB archives and Azure SQL BACPACs.

Recompressing them gains a fraction of a percent at best, and costs the full CPU time plus a
complete extra write and read of the file through a temporary file. On a photo or video
library that is the difference between a backup that finishes and one that does not.

::: info The files are still in the backup
This only skips the compression step. Nothing is left out. To leave files out of a backup,
use [exclude patterns](/user-guide/features/file-backups) on the directory source.
:::

### Formats stored as-is

Matched on the file extension, case-insensitive, and only the last one - so `photos.tar.gz`
counts as `gz`.

<!-- The table below is checked against src/lib/incompressible-formats.ts by
     tests/unit/lint-guards/incompressible-formats-doc.test.ts. Edit both together. -->

| Category | Extensions |
| :--- | :--- |
| Video | `3gp` `avi` `flv` `m2ts` `m4v` `mkv` `mov` `mp4` `mpeg` `mpg` `mts` `ts` `vob` `webm` `wmv` |
| Audio | `aac` `ape` `flac` `m4a` `mka` `mp3` `oga` `ogg` `opus` `wma` |
| Images | `avif` `gif` `heic` `heif` `jp2` `jpeg` `jpg` `jxl` `png` `webp` |
| Archives | `7z` `br` `bz2` `cab` `gz` `lz4` `lzma` `rar` `tbz2` `tgz` `txz` `xz` `zip` `zst` |
| ZIP containers | `apk` `bacpac` `docx` `epub` `ipa` `jar` `nupkg` `odp` `ods` `odt` `pptx` `vsix` `war` `whl` `xlsx` `xpi` |
| Web fonts | `woff` `woff2` |
| Encrypted | `age` `enc` `gpg` `pgp` |
| Disk images | `dmg` |

Everything else is compressed normally. Some formats look like they belong on this list and
are left off on purpose, because they compress well often enough to be worth the attempt -
PDFs, executables and ISO images among them.

If a format is missing and you are backing up a lot of it, that is worth
[reporting](https://github.com/Skyfay/DBackup/issues) - the list ships in the code and grows
with releases, without anything to reconfigure.

### Behaviour

It is automatic and needs no configuration. The job log names how many files were affected:

```
412 file(s) stored uncompressed (38.1 GB) - their format is already compressed
```

Restore, download and file-level restore handle this by themselves, and so does the
[Recovery Kit](/user-guide/security/recovery-kit), including kits you downloaded earlier.
Every file records how it was stored, so nothing has to be worked out at restore time.

Unpacking an unencrypted backup by hand is the one place it shows: a stored file keeps its
real name and is immediately usable, while a compressed one ends in `.gz` or `.br`.

## Pipeline Order

Compression happens **before** encryption:

```
Database → Dump → Compress → Encrypt → Upload
                     ↑          ↑
                   Gzip/Brotli  AES-256
```

This order is optimal because:
1. Encrypted data doesn't compress well
2. Compression works best on text data
3. Smaller encrypted file to upload

## Streaming Architecture

DBackup uses **streaming compression**:

```javascript
dumpStream
  .pipe(compressionStream)
  .pipe(encryptionStream)
  .pipe(uploadStream)
```

Benefits:
- **Low memory**: Doesn't load entire file
- **Fast**: Parallel processing
- **Scalable**: Works with any size database

## When to Use

### Use Gzip When

- Backup speed is critical
- CPU resources are limited
- Compatibility is important
- Good balance needed

### Use Brotli When

- Storage costs are high
- Maximum compression wanted
- Time is not critical
- Modern systems only

### Skip Compression When

- Database contains mostly binary BLOBs
- Network is faster than compression time
- Immediate backups needed

## Storage Savings

### Example: 1GB Database

| Setup | Size | Monthly Cost* |
| :--- | :--- | :--- |
| No compression | 30 GB (30 daily) | $0.69 |
| Gzip | 7.5 GB | $0.17 |
| Brotli | 6 GB | $0.14 |

*S3 Standard pricing ($0.023/GB)

### Yearly Savings

For 10 databases with Smart retention:
- No compression: ~300 GB = $83/year
- With Gzip: ~75 GB = $21/year
- **Savings: $62/year per 10 databases**

## Restore and Download

### Automatic Decompression

When restoring or downloading:
1. DBackup reads metadata
2. Detects compression algorithm
3. Decompresses automatically

### Manual Decompression

If needed outside DBackup:

```bash
# Gzip
gunzip backup.sql.gz

# Brotli
brotli -d backup.sql.br
```

## Performance Tuning

### CPU Considerations

Compression uses CPU. Monitor during backups:
- High CPU: Consider Gzip over Brotli
- Multiple jobs: Stagger schedules

### Memory Usage

Streaming keeps memory low, but:
- Brotli uses more memory than Gzip
- Large databases may need more resources

### Disk I/O

Compression reduces disk writes:
- Smaller temp files
- Faster uploads
- Less disk wear

## Metadata Storage

Compression info stored in `.meta.json`:

```json
{
  "compression": "GZIP",
  "encryption": {
    "enabled": false
  },
  "originalSize": 104857600,
  "compressedSize": 26214400
}
```

## Troubleshooting

### Compression Slow

**Causes**:
- Large database
- Brotli algorithm
- CPU constraints

**Solutions**:
1. Switch to Gzip
2. Schedule during low-usage
3. Check CPU availability

### Decompression Fails

**Causes**:
- Corrupted file
- Wrong algorithm detected
- Incomplete download

**Solutions**:
1. Re-download from storage
2. Check `.meta.json` for correct algorithm
3. Verify file integrity

### File Larger After Compression

**Cause**: Already compressed data. In a file backup, known formats are stored as-is
automatically, so this points at content the extension does not give away - a database dump
full of BLOBs, or files with a misleading name.

**Solution:** Set the job to `None`. There is nothing to gain from compressing data that is
already compressed, and it costs the CPU time either way.

## Best Practices

1. **Start with Gzip** - Good balance for most cases
2. **Monitor backup times** - Switch if too slow
3. **Compare sizes** - Test both algorithms
4. **Enable for all jobs** - Storage savings add up
5. **Combine with encryption** - Compress then encrypt
6. **Test restores** - Verify decompression works

## Next Steps

- [Encryption](/user-guide/security/encryption) - Encrypt compressed backups
- [Creating Jobs](/user-guide/jobs/) - Configure compression
- [Storage Explorer](/user-guide/features/storage-explorer) - View backup sizes
