# Update Service

The Update Service checks for new versions of Database Backup Manager by querying the GitHub REST API for repository tags.

## How It Works

1. **Configuration Check**: Reads `general.checkForUpdates` from SystemSettings
2. **API Query**: Fetches tags from `https://api.github.com/repos/Skyfay/DBackup/tags`
3. **Channel Detection**: Determines the stability channel of the current installation
4. **Filtering**: Filters available updates based on current channel
5. **SemVer Comparison**: Sorts tags and checks for newer versions

## Channel Logic

The system distinguishes three stability levels. Users only see updates that are equally or more stable than their current version.

| Current Channel | Version Pattern | Stability | Visible Updates |
|-----------------|-----------------|-----------|-----------------|
| **Stable** | `x.y.z` | 3 | Stable only |
| **Beta** | `x.y.z-beta` | 2 | Beta + Stable |
| **Dev** | `x.y.z-dev` | 1 | Dev + Beta + Stable |

### Stability Calculation

```typescript
function getStability(prerelease: string | null): number {
  if (prerelease === null) return 3; // Stable
  if (prerelease.includes('beta')) return 2;
  if (prerelease.includes('dev')) return 1;
  return 0; // Unknown
}
```

Only tags with `TargetStability >= CurrentStability` are considered.

## Semantic Versioning

Comparison follows strict [SemVer](https://semver.org/) rules:

1. **Major/Minor/Patch**: Numeric comparison (`1.1.0 > 1.0.9`)
2. **Pre-Release**: When versions match, stable wins
   - `1.0.0` > `1.0.0-beta` > `1.0.0-dev`

## Service Implementation

**Location**: `src/services/update-service.ts`

```typescript
class UpdateService {
  async checkForUpdates(): Promise<UpdateCheckResult> {
    // Check if feature is enabled
    const enabled = await getSystemSetting('general.checkForUpdates', true);
    if (!enabled) return { available: false };

    // Fetch tags from registry
    const tags = await this.fetchTags();

    // Get current version
    const current = this.getCurrentVersion();

    // Find latest compatible update
    const latest = this.findLatestUpdate(tags, current);

    return {
      available: latest !== null,
      currentVersion: current,
      latestVersion: latest,
    };
  }

  private async fetchTags(): Promise<string[]> {
    const response = await fetch(
      'https://api.github.com/repos/Skyfay/DBackup/tags?per_page=100',
      {
        headers: { "Accept": "application/vnd.github+json" },
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );
    return response.json();
  }
}
```

## API Endpoint

```http
GET /api/system/updates
```

**Response:**
```json
{
  "available": true,
  "currentVersion": "0.8.3-beta",
  "latestVersion": "0.9.0-beta",
  "releaseUrl": "https://github.com/Skyfay/DBackup/releases/tag/v0.9.0-beta",
  "releaseNotes": "Microsoft SQL Server support..."
}
```

## System Task Integration

The update check runs as the system task **Check for updates** (`system.check_for_updates`, see `src/services/system/system-task-definitions.ts`):

- **Default schedule**: every day at 00:00 (`0 0 * * *`), in the time zone of General
- **On start**: ten seconds after DBackup started, once per start
- **By hand**: Settings → System tasks → Run now

The task has no switch of its own. It follows **Look for new versions** under Settings → General (`general.checkForUpdates`), so `getTaskEnabled` and `setTaskEnabled` of `system-task-service.ts` read and write that setting. While it is off, `updateService.checkForUpdates()` returns without asking GitHub, for the task and for the header alike. A new version is reported through the notification `UPDATE_AVAILABLE`, at most once per version within its reminder interval.

## In the dashboard

The dashboard layout (`src/app/dashboard/layout.tsx`) calls `updateService.checkForUpdates()` on every page load and hands the result to the header. `HeaderLinks` in `src/components/layout/header-links.tsx` groups the guides, DBackup on GitHub and, while `updateAvailable` is true, the update: an arrow with a blue dot in the `create` tone. It opens a card with the running and the newest version, the command that pulls the new image, the release on GitHub and What's new.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `general.checkForUpdates` | `true` | **Look for new versions** under Settings → General. Off, DBackup never asks GitHub and the header shows no update. |

## Caching

API responses are cached for 1 hour to reduce external requests:

```typescript
fetch(url, {
  next: { revalidate: 3600 }, // Next.js cache
});
```

A run of **Check for updates** reads through the same cache of an hour.
