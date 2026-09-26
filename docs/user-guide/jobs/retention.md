# Retention Policies

Automatically manage backup storage by defining how long to keep backups.

## Overview

Retention policies prevent unlimited storage growth by automatically deleting old backups. DBackup supports three retention modes:

| Mode | Description | Best For |
| :--- | :--- | :--- |
| **None** | Keep all backups | Manual management |
| **Simple** | Keep last N backups | Fixed rotation |
| **Smart (GFS)** | Grandfather-Father-Son | Long-term archival |

## Per-Destination Retention

Retention is configured **individually for each destination** within a job. This means a single job can have different retention strategies per storage location.

### Example

| Destination | Mode | Configuration |
| :--- | :--- | :--- |
| Local NAS | Simple | Keep last 30 |
| AWS S3 | Smart (GFS) | Daily: 7, Weekly: 4, Monthly: 12 |
| Dropbox | None | Keep all |

### Configuration

In the **Destinations** part of the job form, every destination row has its own retention policy picker:
1. Open the **Destinations** part of the job
2. Pick a policy on each destination, or **Default policy** for the one marked as the system default
3. Policies are created under **Administration → Templates → Retention Policies**, where their mode (Simple or Smart) is set
4. Each destination keeps its backups by its own policy

## Simple Retention

Keep a fixed number of recent backups.

### Configuration

| Setting | Description |
| :--- | :--- |
| **Keep Count** | Number of backups to retain |

### Example

With `Keep Count: 5`:
- After 6th backup: 1st is deleted
- After 7th backup: 2nd is deleted
- Always maintains exactly 5 backups

### Use Cases

- Development environments
- Frequent backups with short retention
- Simple rotation needs

## Smart Retention (GFS)

Grandfather-Father-Son is an intelligent retention strategy that keeps:
- The most recent backups (hourly, optional)
- Recent backups (daily)
- Some older backups (weekly)
- Fewer old backups (monthly)
- Minimal very old backups (yearly)

### Configuration

| Setting | Description | Example |
| :--- | :--- | :--- |
| **Hourly** | Hourly backups to keep, off unless enabled | `24` |
| **Daily** | Days to keep daily backups | `7` |
| **Weekly** | Weeks to keep weekly backups | `4` |
| **Monthly** | Months to keep monthly backups | `12` |
| **Yearly** | Years to keep yearly backups | `3` |

### Hourly Tier

Most schedules do not need an hourly tier, so the field is hidden until you ask for it. In the policy form, click **Add hourly tier** below the tier inputs. It starts at `24` and can be removed again with **Remove hourly tier**, which sets it back to `0`.

A policy that already has an hourly value opens with the field visible. Policies created before this tier existed keep exactly the same deletion behaviour, because a missing value counts as `0`.

::: tip Sub-hourly schedules
A job running every 15 minutes with **Hourly: 24** keeps one backup per hour and deletes the other three. That is the point of the tier, but it is a change in outcome if you are switching over from **Simple** retention.
:::

### How It Works

Each tier keeps the newest backup of every time bucket it covers, working from the newest backup backwards. Buckets that a finer tier already covers are skipped, and a tier only counts what it adds itself.

1. **Hourly bucket**: the newest backup of each of the last N hours that have backups
2. **Daily bucket**: the newest backup of each of the next N days
3. **Weekly bucket**: the newest backup of each of the next N weeks
4. **Monthly bucket**: the newest backup of each of the next N months
5. **Yearly bucket**: the newest backup of each of the next N years

::: warning The tiers add up, they do not overlap
**Daily: 7** means seven days *on top of* what the hourly tier already covers, not seven days in total. With **Hourly: 24, Daily: 7** the policy reaches back roughly nine days and keeps about 31 backups.

restic and borg read the same numbers as a union, where the daily window includes the hours the hourly tier covers. A config copied from one of those tools keeps more in DBackup than it does there.
:::

A tier counts buckets that **have** backups, not wall-clock time. If a run is skipped, **Hourly: 24** reaches further back than 24 hours rather than losing a slot.

::: warning Daylight saving time
Buckets are built in the timezone configured under Settings. When the clock goes back, the repeated hour maps to a single hourly bucket, so one backup loses its slot once a year. Day, week, month and year buckets are unaffected.
:::

### Example Timeline

Configuration: Daily=7, Weekly=4, Monthly=12, Yearly=2

After 1 year of daily backups:
- **Daily**: the 7 newest days
- **Weekly**: 4 further weeks, starting after the weeks the daily tier already covers
- **Monthly**: 12 further months, starting after the months covered so far
- **Yearly**: 2 further years

**Total**: 25 backups instead of 365, the sum of the four tiers.

Adding **Hourly: 24** to the same policy keeps roughly 24 more, and the daily tier then starts after the hours it covers rather than at today.

### Visual Example

```
Now      last 24h        7 days         weeks        months        years
 |          |              |              |             |            |
 ▼          ▼              ▼              ▼             ▼            ▼
[■■■■■■■■■■■■][■][■][■][■][■][■][■]   [■]   [■]   [■]...       [■]  [■]
 └── Hourly ──┘└───── Daily ─────┘   └ Weekly ┘  └ Monthly ┘   └ Yearly ┘
```

## Locked Backups

Prevent specific backups from being deleted:

1. Go to **Storage Explorer**
2. Find the backup
3. Click **Lock** icon

Locked backups:
- ✅ Never deleted by retention
- ✅ Don't count against limits
- ✅ Persist indefinitely

### Use Cases for Locking

- Pre-migration snapshots
- Known-good backups
- Compliance requirements
- Before major changes

## Configuration Guide

### Conservative (Long Retention)

```
Daily: 14
Weekly: 8
Monthly: 24
Yearly: 5
```

Keeps 51 backups over 5 years.

### Moderate (Balanced)

```
Daily: 7
Weekly: 4
Monthly: 12
Yearly: 2
```

Keeps 25 backups over 2 years.

### Aggressive (Minimal)

```
Daily: 3
Weekly: 2
Monthly: 6
Yearly: 1
```

Keeps 12 backups over 1 year.

### Hourly Schedule

```
Hourly: 24
Daily: 7
Weekly: 4
Monthly: 12
```

Keeps 47 backups and gives a full day at hourly resolution before the daily tier takes over.

## Retention Execution

Retention runs as the **final step** of each backup job, applied **per destination**:

1. Backup upload completes for a destination
2. List all backups for this job in that specific destination
3. Read each backup's metadata sidecar for its lock status, chain, job and creation time
4. Apply that destination's retention policy
5. Delete expired backups
6. Repeat for each remaining destination

::: tip Skipped on Failure
Retention is skipped for any destination where the upload failed. This prevents deleting old backups when the new backup didn't arrive.
:::

### Which Backups Count

Retention only removes backups the job made itself, known by the job id in their `.meta.json` sidecar. A job named like a deleted one writes into the same folder, and the backups the deleted job left there stay until you delete them in the [Storage Explorer](/user-guide/features/storage-explorer#backups-of-a-deleted-job). The run log names them. A backup without a sidecar counts as the job's own, like before DBackup recorded the job.

A renamed job writes into a folder with its new name. Retention follows it into the folder of its old name and judges the backups there together with the new ones, so the policy keeps covering every backup the job made. DBackup finds those folders in its list of the destination, and only backups whose sidecar names the job count there. The run log says how many it found in each folder.

### Which Time a Backup Is Judged By

Backups are sorted into buckets by the creation time **DBackup recorded when it wrote the backup**, which is stored in the backup's `.meta.json` sidecar. The file's modification time on the destination is only used when there is no sidecar, for backups taken before this was recorded or for destinations DBackup cannot read files from.

This matters because a modification time is easy to lose. Copying the backup directory without preserving timestamps, moving it to another server, or restoring it from a backup of its own stamps every file with the current time. Judged by that, the entire history collapses into a single bucket and the next retention pass deletes all but one backup from it.

The run log names any backup whose two times disagree by more than an hour, so a destination in that state is visible before it costs anything.

## Compliance Considerations

### GDPR

- Consider data minimization principles
- Balance retention vs. "right to erasure"
- Document retention policy

### SOX/Financial

- May require 7+ years retention
- Use yearly retention setting
- Lock compliance-critical backups

### HIPAA

- Minimum 6 years retention
- Consider encryption for all backups
- Document access to backups

## Best Practices

### Match Schedule to Retention

| Schedule | Recommended Retention |
| :--- | :--- |
| Hourly | Hourly: 24-48, plus Daily: 7-14 |
| Daily | Daily: 7-14 |
| Weekly | Weekly: 4-8 |
| Monthly | Monthly: 12-24 |

### Start Conservative

Begin with longer retention, then reduce:
1. Storage is cheap
2. You can't recover deleted backups
3. Analyze needs before reducing

### Test Before Production

1. Create test job with short retention
2. Verify deletion works correctly
3. Then apply to production

### Monitor Storage

- Watch storage growth
- Adjust retention if growing too fast
- Use compression to reduce size

## Storage Calculation

Estimate storage needs:

```
Storage = (Backup Size) × (Retained Backups)
```

Example with Smart Retention (Daily=7, Weekly=4, Monthly=12, Yearly=2):
- 100MB daily backup
- ~25 backups retained
- Storage: ~2.5GB

With compression (70% reduction):
- Storage: ~750MB

## Troubleshooting

### Backups Not Being Deleted

1. Verify retention is enabled on job
2. Check if backups are locked
3. View job logs for retention step
4. Ensure backup ran successfully

### Everything Was Deleted After Moving a Destination

Check the retention step in the run log for warnings about backups whose recorded creation time disagrees with the destination's modification time. Backups written before DBackup recorded a creation time fall back to the modification time, and a move that did not preserve timestamps puts all of them in the same bucket. Lock the backups you cannot lose before moving a destination.

### Too Many Backups Deleted

1. Check retention settings
2. Verify date/time on backups
3. Lock important backups
4. Increase retention values

### Wrong Backups Deleted

The GFS algorithm keeps the **newest** backup in each time bucket. A week with seven backups keeps the one from the end of the week, not the start.

If a destination holds more backups than the policy allows, check the retention step in the run log. Locked backups and incremental chains are both kept beyond the policy, and the log names them.

## API Reference

Retention configuration in job:

```json
{
  "retention": {
    "mode": "SMART",
    "simple": {
      "keepCount": 5
    },
    "smart": {
      "hourly": 24,
      "daily": 7,
      "weekly": 4,
      "monthly": 12,
      "yearly": 2
    }
  }
}
```

`hourly` may be omitted. A missing value counts as `0` and disables the tier.

## Next Steps

- [Creating Jobs](/user-guide/jobs/) - Configure backup jobs
- [Storage Explorer](/user-guide/features/storage-explorer) - Browse and lock backups
- [Encryption](/user-guide/security/encryption) - Secure your backups
