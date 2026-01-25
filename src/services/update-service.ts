import prisma from "@/lib/prisma";
import packageJson from "../../package.json";

interface UpdateInfo {
  updateAvailable: boolean;
  latestVersion: string;
  currentVersion: string;
  error?: string;
}

const GITLAB_PROJECT_ID = "66715081";
const REGISTRY_ID = "9667280";

export const updateService = {
  async checkForUpdates(): Promise<UpdateInfo> {
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

      // 2. Fetch tags from GitLab Registry API
      // We use the public API since it's a public repository
      // Increased per_page to 20 to catch stable versions if many dev tags exist
      const response = await fetch(
        `https://gitlab.com/api/v4/projects/${GITLAB_PROJECT_ID}/registry/repositories/${REGISTRY_ID}/tags?per_page=20&order_by=updated_at&sort=desc`,
        { next: { revalidate: 3600 } } // Cache for 1 hour
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch tags: ${response.statusText}`);
      }

      const tags: { name: string }[] = await response.json();

      if (!tags || tags.length === 0) {
        return {
            updateAvailable: false,
            latestVersion: currentVersion,
            currentVersion,
        };
      }

// 3. Find latest relevant version

      // Parse current version
      const current = parseVersion(currentVersion);
      if (!current) {
          console.error(`Invalid current version in package.json: ${currentVersion}`);
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
      console.error("Update check failed:", error);
      return {
        updateAvailable: false,
        latestVersion: currentVersion,
        currentVersion,
        error: "Failed to check for updates",
      };
    }
  },
};

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
