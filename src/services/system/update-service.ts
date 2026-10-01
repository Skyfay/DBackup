import prisma from "@/lib/prisma";
import packageJson from "../../../package.json";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ service: "UpdateService" });

interface UpdateInfo {
  updateAvailable: boolean;
  latestVersion: string;
  currentVersion: string;
  error?: string;
}

const GITHUB_OWNER = "Skyfay";
const GITHUB_REPO = "DBackup";

/** How long the dashboard shows an answer of GitHub, and how soon a check that failed runs again. */
const ANSWER_KEPT_MS = 60 * 60 * 1000;
const FAILURE_KEPT_MS = 10 * 60 * 1000;

/** The last answer of a check, which the dashboard shows without waiting for GitHub. */
let lastCheck: { info: UpdateInfo; at: number } | null = null;
let checking: Promise<UpdateInfo> | null = null;

function noUpdate(currentVersion: string): UpdateInfo {
  return { updateAvailable: false, latestVersion: currentVersion, currentVersion };
}

export const updateService = {
  /** Asks GitHub for the newest version now, and keeps the answer for the dashboard. */
  async checkForUpdates(): Promise<UpdateInfo> {
    const info = await fetchUpdateInfo();
    lastCheck = { info, at: Date.now() };
    return info;
  },

  /**
   * What the dashboard shows about a new version, without ever waiting for GitHub: the last answer,
   * and a check in the background once it is old. On an instance without internet every page would
   * otherwise wait for the timeout of the request, since a failed answer is never cached by fetch.
   */
  async getUpdateInfo(): Promise<UpdateInfo> {
    const currentVersion = packageJson.version;
    try {
      const setting = await prisma.systemSetting.findUnique({ where: { key: "general.checkForUpdates" } });
      if (setting && setting.value !== "true") return noUpdate(currentVersion);
    } catch (error) {
      log.error("Reading whether to look for new versions failed", {}, wrapError(error));
      return noUpdate(currentVersion);
    }

    const keptFor = lastCheck?.info.error ? FAILURE_KEPT_MS : ANSWER_KEPT_MS;
    if ((!lastCheck || Date.now() - lastCheck.at > keptFor) && !checking) {
      // checkForUpdates never throws, it answers a failure with `error`.
      checking = updateService.checkForUpdates().finally(() => {
        checking = null;
      });
    }
    return lastCheck?.info ?? noUpdate(currentVersion);
  },
};

async function fetchUpdateInfo(): Promise<UpdateInfo> {
  const currentVersion = packageJson.version;

  try {
    // 1. Check if updates are enabled in settings
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "general.checkForUpdates" },
    });

    const isEnabled = setting ? setting.value === "true" : true;

    if (!isEnabled) {
      return {
        updateAvailable: false,
        latestVersion: currentVersion,
        currentVersion,
      };
    }

    // 2. Fetch tags from GitHub API
    // Public repos don't require authentication
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags?per_page=100`,
        {
          headers: { "Accept": "application/vnd.github+json" },
          next: { revalidate: 3600 },
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch tags: ${response.statusText}`);
    }

    const data: { name: string }[] = await response.json();

    if (!data || data.length === 0) {
      return {
          updateAvailable: false,
          latestVersion: currentVersion,
          currentVersion,
      };
    }

    const tags = data
      .filter(t => /^v?\d+\.\d+\.\d+/.test(t.name))
      .map(t => ({ name: t.name }));

// 3. Find latest relevant version

    // Parse current version
    const current = parseVersion(currentVersion);
    if (!current) {
        log.error("Invalid current version in package.json", { currentVersion });
        return { updateAvailable: false, latestVersion: currentVersion, currentVersion };
    }

    const currentStability = getStability(current.prerelease);

    // Filter and parse tags
    const validTags = tags
      .map(t => t.name)
      .map(name => ({ name, version: parseVersion(name) }))
      .filter(item => item.version !== null) as { name: string, version: ParsedVersion }[];

    // Filter by stability channel
    // Rules:
    // - Stable user (3) -> Only updates to Stable (3)
    // - Beta user (2) -> Updates to Beta (2) or Stable (3)
    // - Dev user (1) -> Updates to Dev (1), Beta (2), or Stable (3)
    const relevantTags = validTags.filter(item => {
        const tagStability = getStability(item.version.prerelease);
        return tagStability >= currentStability;
    });

    if (relevantTags.length === 0) {
        return { updateAvailable: false, latestVersion: currentVersion, currentVersion };
    }

    // Sort by SemVer descending
    relevantTags.sort((a, b) => compareSemver(b.version, a.version));

    const latest = relevantTags[0];

    // Compare latest relevant vs current
    if (compareSemver(latest.version, current) > 0) {
      return {
        updateAvailable: true,
        latestVersion: latest.name,
        currentVersion,
      };
    }

    return {
      updateAvailable: false,
      latestVersion: currentVersion,
      currentVersion,
    };

  } catch (error) {
    log.error("Update check failed", {}, wrapError(error));
    return {
      updateAvailable: false,
      latestVersion: currentVersion,
      currentVersion,
      error: "Failed to check for updates",
    };
  }
}

interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease: string | null; // e.g., "dev", "beta", "rc", or null for stable
}

function parseVersion(v: string): ParsedVersion | null {
    const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match) return null;
    return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3]),
        prerelease: match[4] || null,
    };
}

function getStability(prerelease: string | null): number {
    if (prerelease === null) return 3; // Stable
    if (prerelease.includes('beta')) return 2; // Beta
    if (prerelease.includes('dev')) return 1; // Dev
    return 0; // Other/Unknown (lower than dev)
}

function compareSemver(v1: ParsedVersion, v2: ParsedVersion): number {
    // 1. Compare Major, Minor, Patch
    if (v1.major !== v2.major) return v1.major - v2.major;
    if (v1.minor !== v2.minor) return v1.minor - v2.minor;
    if (v1.patch !== v2.patch) return v1.patch - v2.patch;

    // 2. Compare Pre-release
    // Stability precedence: Stable (null) > Beta > Dev
    // If one is stable and other is prerelease
    if (v1.prerelease === null && v2.prerelease !== null) return 1;
    if (v1.prerelease !== null && v2.prerelease === null) return -1;

    // If both are stable (null), they are equal
    if (v1.prerelease === null && v2.prerelease === null) return 0;

    // Both are prereleases. Compare strings/priority explicitly
    const s1 = getStability(v1.prerelease);
    const s2 = getStability(v2.prerelease);

    if (s1 !== s2) return s1 - s2;

    // If stability level is same (e.g. both 'dev'), compare lexicographically
    // or by checking for trailing numbers (dev1 vs dev2)
    // Simple string compare as fallback
    return v1.prerelease!.localeCompare(v2.prerelease!);
}
