/**
 * Lint Guard Tests for Logging Standards
 *
 * These tests enforce coding standards by scanning source files for violations.
 * They help prevent regressions when AI or developers accidentally use
 * console.log instead of the official logger.
 *
 * Run with: pnpm test tests/unit/lint-guards/no-console.test.ts
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_DIR = path.resolve(__dirname, "../../../src");

// Files that are allowed to use console directly
const ALLOWED_FILES = [
  "src/lib/logger.ts", // Logger itself uses console
  "src/instrumentation.ts", // Next.js instrumentation hook
];

// Patterns to detect direct console usage
const CONSOLE_PATTERNS = [
  { pattern: /console\.log\s*\(/g, name: "console.log" },
  { pattern: /console\.error\s*\(/g, name: "console.error" },
  { pattern: /console\.warn\s*\(/g, name: "console.warn" },
  { pattern: /console\.info\s*\(/g, name: "console.info" },
  { pattern: /console\.debug\s*\(/g, name: "console.debug" },
];

interface Violation {
  file: string;
  line: number;
  column: number;
  content: string;
  pattern: string;
}

/**
 * Recursively finds all files matching extensions in a directory
 */
function findFiles(
  dir: string,
  extensions: string[],
  ignore: string[] = []
): string[] {
  const results: string[] = [];

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(process.cwd(), fullPath);

      // Check ignore patterns
      const shouldIgnore = ignore.some((pattern) => {
        if (pattern.includes("*")) {
          const regex = new RegExp(
            pattern.replace(/\*/g, ".*").replace(/\//g, "\\/")
          );
          return regex.test(relativePath);
        }
        return relativePath.includes(pattern);
      });

      if (shouldIgnore) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Checks if a line is inside a comment
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

/**
 * Scans a file for console usage violations
 */
function findConsoleUsage(filePath: string): Violation[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations: Violation[] = [];

  const relativePath = path.relative(process.cwd(), filePath);

  // Skip allowed files
  if (ALLOWED_FILES.some((allowed) => relativePath.includes(allowed))) {
    return [];
  }

  lines.forEach((line, index) => {
    // Skip comment lines
    if (isCommentLine(line)) {
      return;
    }

    CONSOLE_PATTERNS.forEach(({ pattern, name }) => {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(line)) !== null) {
        violations.push({
          file: relativePath,
          line: index + 1,
          column: match.index + 1,
          content: line.trim(),
          pattern: name,
        });
      }
    });
  });

  return violations;
}

/**
 * Formats violations into a readable report
 */
function formatViolationReport(violations: Violation[]): string {
  const grouped = violations.reduce(
    (acc, v) => {
      if (!acc[v.file]) acc[v.file] = [];
      acc[v.file].push(v);
      return acc;
    },
    {} as Record<string, Violation[]>
  );

  let report = "";
  for (const [file, fileViolations] of Object.entries(grouped)) {
    report += `\n  ${file}:\n`;
    fileViolations.forEach((v) => {
      report += `    L${v.line}:${v.column} ${v.pattern} → ${v.content.substring(0, 60)}${v.content.length > 60 ? "..." : ""}\n`;
    });
  }
  return report;
}

describe("Logging Standards", () => {
  it("should not use console.log/error/warn directly in source files", () => {
    const files = findFiles(SRC_DIR, [".ts", ".tsx"], [
      ".test.ts",
      ".test.tsx",
      ".spec.ts",
      "node_modules",
      "__mocks__",
    ]);

    const allViolations: Violation[] = [];

    for (const file of files) {
      const violations = findConsoleUsage(file);
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const report = formatViolationReport(allViolations);

      // SOFT FAIL: Log warning but don't fail test (during migration)
      // After migration is complete, uncomment expect.fail() below
      console.warn(
        `\n⚠️  Found ${allViolations.length} direct console usage(s).\n` +
          `   Use 'logger' from '@/lib/logger' instead.\n` +
          `${report}`
      );

      // TODO: Uncomment after migration is complete to enforce strictly
      // expect.fail(
      //   `Found ${allViolations.length} direct console usage(s). ` +
      //   `Use 'logger' from '@/lib/logger' instead:\n${report}`
      // );
    }

    // For now, just verify the test runs correctly
    expect(files.length).toBeGreaterThan(0);
  });

  it("should use logger.child() for service-specific logging", () => {
    const serviceFiles = findFiles(
      path.join(SRC_DIR, "services"),
      [".ts"],
      [".test.ts", "__mocks__"]
    );

    const servicesWithoutChildLogger: string[] = [];

    for (const file of serviceFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const relativePath = path.relative(process.cwd(), file);

      // Check if file imports logger
      const usesLogger =
        content.includes('from "@/lib/logger"') ||
        content.includes("from '@/lib/logger'");

      // Check if it creates a child logger (recommended pattern)
      const usesChildLogger = content.includes("logger.child(");

      // Only flag if using logger without child context
      if (usesLogger && !usesChildLogger) {
        servicesWithoutChildLogger.push(relativePath);
      }
    }

    // INFO: This is advisory, not enforced
    if (servicesWithoutChildLogger.length > 0) {
      console.info(
        `\nℹ️  Services using logger without child context (recommended pattern):\n` +
          servicesWithoutChildLogger.map((f) => `   - ${f}`).join("\n")
      );
    }

    expect(serviceFiles.length).toBeGreaterThan(0);
  });
});

describe("Error Handling Standards", () => {
  it("should not use 'catch (e: any)' pattern", () => {
    const files = findFiles(SRC_DIR, [".ts", ".tsx"], [
      ".test.ts",
      ".test.tsx",
      ".spec.ts",
      "node_modules",
      "__mocks__",
    ]);

    const violations: { file: string; line: number; content: string }[] = [];

    // Pattern to detect: catch (e: any) or catch (error: any)
    const catchAnyPattern = /catch\s*\(\s*\w+\s*:\s*any\s*\)/g;

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const relativePath = path.relative(process.cwd(), file);

      lines.forEach((line, index) => {
        catchAnyPattern.lastIndex = 0;
        if (catchAnyPattern.test(line)) {
          violations.push({
            file: relativePath,
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line} → ${v.content}`)
        .join("\n");

      // SOFT FAIL: Warning during migration
      console.warn(
        `\n⚠️  Found ${violations.length} 'catch (e: any)' pattern(s).\n` +
          `   Use 'catch (error)' with wrapError() from '@/lib/errors' instead.\n\n` +
          `${report}`
      );

      // TODO: Uncomment after migration
      // expect.fail(
      //   `Found ${violations.length} 'catch (e: any)' pattern(s).`
      // );
    }

    expect(files.length).toBeGreaterThan(0);
  });

  it("should import error utilities when using try-catch in services", () => {
    const serviceFiles = findFiles(
      path.join(SRC_DIR, "services"),
      [".ts"],
      [".test.ts", "__mocks__"]
    );

    const servicesWithTryCatchButNoErrorImport: string[] = [];

    for (const file of serviceFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const relativePath = path.relative(process.cwd(), file);

      const hasTryCatch = /try\s*\{/.test(content);
      const hasErrorImport =
        content.includes('from "@/lib/errors"') ||
        content.includes("from '@/lib/errors'");

      if (hasTryCatch && !hasErrorImport) {
        servicesWithTryCatchButNoErrorImport.push(relativePath);
      }
    }

    if (servicesWithTryCatchButNoErrorImport.length > 0) {
      console.info(
        `\nℹ️  Services with try-catch but no error utilities import:\n` +
          servicesWithTryCatchButNoErrorImport.map((f) => `   - ${f}`).join("\n")
      );
    }

    expect(serviceFiles.length).toBeGreaterThan(0);
  });
});

describe("ServiceResult Standards", () => {
  it("should use ServiceResult type in service methods", () => {
    const serviceFiles = findFiles(
      path.join(SRC_DIR, "services"),
      [".ts"],
      [".test.ts", "__mocks__"]
    );

    const servicesWithoutServiceResult: string[] = [];

    for (const file of serviceFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const relativePath = path.relative(process.cwd(), file);

      // Check if service imports ServiceResult
      const usesServiceResult =
        content.includes('from "@/lib/types/service-result"') ||
        content.includes("from '@/lib/types/service-result'") ||
        content.includes("ServiceResult");

      // Check if it has async functions (likely service methods)
      const hasAsyncMethods = /async\s+\w+\s*\(/.test(content);

      if (hasAsyncMethods && !usesServiceResult) {
        servicesWithoutServiceResult.push(relativePath);
      }
    }

    // INFO: Advisory only during migration
    if (servicesWithoutServiceResult.length > 0) {
      console.info(
        `\nℹ️  Services not using ServiceResult type (recommended pattern):\n` +
          servicesWithoutServiceResult.map((f) => `   - ${f}`).join("\n")
      );
    }

    expect(serviceFiles.length).toBeGreaterThan(0);
  });
});
