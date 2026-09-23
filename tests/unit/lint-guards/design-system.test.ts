/**
 * Lint Guards: design system conventions that are invisible in review.
 *
 * These rules exist because breaking them produces code that reads correctly and
 * still looks or behaves wrong - the class of mistake a reviewer skims past. They are
 * documented in src/components/CLAUDE.md; this file is what makes them stick.
 *
 * Three are enforced, two report only. The advisory ones are not weaker rules, they are
 * rules whose existing violation count is too large to fix in one pass - promote them
 * once the backlog is clear.
 *
 * Run with: pnpm test tests/unit/lint-guards/design-system.test.ts
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_DIR = path.resolve(__dirname, "../../../src");

/** Shadcn primitives own the low-level scroll and color behavior every other rule builds on. */
const UI_PRIMITIVES = `src${path.sep}components${path.sep}ui${path.sep}`;

interface Violation {
    file: string;
    line: number;
    content: string;
}

function collectTsx(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectTsx(full, acc);
        else if (/\.tsx$/.test(entry.name)) acc.push(full);
    }
    return acc;
}

function collectTsAndTsx(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectTsAndTsx(full, acc);
        else if (/\.tsx?$/.test(entry.name)) acc.push(full);
    }
    return acc;
}

/** Scans files line by line, skipping comments, and collects lines matching a predicate. */
function scan(
    files: string[],
    matches: (line: string) => boolean,
    skipUiPrimitives = true
): Violation[] {
    const violations: Violation[] = [];

    for (const file of files) {
        const relativePath = path.relative(process.cwd(), file);
        if (skipUiPrimitives && relativePath.includes(UI_PRIMITIVES)) continue;

        const lines = fs.readFileSync(file, "utf-8").split("\n");
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
            if (!matches(line)) return;
            violations.push({ file: relativePath, line: index + 1, content: trimmed.slice(0, 110) });
        });
    }

    return violations;
}

function report(violations: Violation[]): string {
    return violations.map((v) => `  ${v.file}:${v.line}\n      ${v.content}`).join("\n");
}

// ============================================================================
// Enforced
// ============================================================================

describe("Scroll containers", () => {
    /**
     * A raw overflow container renders the native OS scrollbar next to the styled Radix one
     * used everywhere else. It looks like a rendering bug rather than a styling choice, and
     * it is worst exactly where it is easiest to add - inside dialogs.
     */
    it("should use ScrollArea instead of raw overflow-y-auto", () => {
        const violations = scan(
            collectTsx(SRC_DIR),
            (line) => /className=[^>]*\boverflow-(y-)?auto\b/.test(line)
        );

        if (violations.length > 0) {
            expect.fail(
                `Found ${violations.length} raw overflow container(s). Use <ScrollArea> from ` +
                `'@/components/ui/scroll-area' instead - see src/components/CLAUDE.md section 1:\n` +
                `${report(violations)}`
            );
        }

        expect(collectTsx(SRC_DIR).length).toBeGreaterThan(0);
    });
});

describe("Date formatting", () => {
    /**
     * Locale formatting silently ignores the user's configured timezone and format. It is
     * indistinguishable from correct output on the developer's own machine, which is why it
     * keeps coming back in chart tooltips and table cells.
     *
     * Number formatting via .toLocaleString() stays allowed - there is no timezone in a row
     * count. Only Date-bound calls are violations.
     */
    it("should use useDateFormatter instead of locale date formatting", () => {
        const violations = scan(collectTsAndTsx(SRC_DIR), (line) => {
            // Date-only methods are always a violation.
            if (/\.toLocaleDateString\s*\(|\.toLocaleTimeString\s*\(/.test(line)) return true;
            // .toLocaleString() is only a violation on something that is clearly a date.
            return /(new Date\([^)]*\)|\b\w*(?:[Dd]ate|At|[Tt]imestamp))\s*\)?\.toLocaleString\s*\(/.test(line);
        });

        if (violations.length > 0) {
            expect.fail(
                `Found ${violations.length} locale date formatting call(s). Use the ` +
                `useDateFormatter hook from '@/hooks/use-date-formatter' so the user's timezone ` +
                `and format preference are respected - see src/components/CLAUDE.md section 8:\n` +
                `${report(violations)}`
            );
        }

        expect(collectTsAndTsx(SRC_DIR).length).toBeGreaterThan(0);
    });
});

describe("Task colors", () => {
    /**
     * A dialog, a popover, a menu entry or a button takes the color of its task through a tone:
     * blue to add, violet to edit, turquoise to pick. The `info` blue only shows that something is
     * running, or marks the newest bar of a chart, so reaching for it on a button or a head brings
     * back the old mix of meanings. Only the components that show one of the two may use it.
     *
     * The rules are under Color in src/app/dashboard/CLAUDE.md, the tones in src/components/ui/tone.ts.
     */
    const INFO_STATUS_FILES = [
        "execution-status.tsx",
        "executions-list.tsx",
        "jobs-list.tsx",
        "stats-strip.tsx",
        "activity-chart.tsx",
        "storage-history-chart.tsx",
        // A job's live run: the progress bar on its card and in its details, the running bar of its run chart.
        "job-card.tsx",
        "job-details-content.tsx",
        "job-run-chart.tsx",
    ];

    it("should keep the info blue to the running status", () => {
        const files = collectTsAndTsx(SRC_DIR).filter((file) => !INFO_STATUS_FILES.includes(path.basename(file)));
        const violations = scan(
            files,
            (line) => /\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via)-info\b|var\(--info\)/.test(line),
            false
        );

        if (violations.length > 0) {
            expect.fail(
                `Found ${violations.length} use(s) of the info blue outside the running status. ` +
                `Give the dialog, popover, menu entry or button a tone instead, like tone="create" - ` +
                `see Color in src/app/dashboard/CLAUDE.md. A component that shows a running status ` +
                `or the newest bar of a chart belongs in INFO_STATUS_FILES:\n${report(violations)}`
            );
        }
    });

    it("should set a tone through the typed prop, not a raw data-tone attribute", () => {
        const violations = scan(collectTsx(SRC_DIR), (line) => /\bdata-tone=/.test(line));

        if (violations.length > 0) {
            expect.fail(
                `Found ${violations.length} raw data-tone attribute(s). Use the tone prop of the ` +
                `primitive or toneAttribute() from '@/components/ui/tone', so a misspelled tone ` +
                `fails the type check:\n${report(violations)}`
            );
        }
    });
});

// ============================================================================
// Ratcheted - existing violations tolerated, new ones fail
// ============================================================================

/**
 * These two rules have a violation backlog too large to clear in one pass, and the default
 * vitest reporter hides console output from passing tests - so an advisory check would be
 * invisible in `pnpm validate`. A baseline count fails the build the moment the number goes
 * up, which is the part that actually matters.
 *
 * Lower the baseline whenever you fix violations. It may never be raised.
 */
function ratchet(name: string, violations: Violation[], baseline: number, guidance: string) {
    if (violations.length > baseline) {
        expect.fail(
            `${name}: ${violations.length} violation(s), baseline is ${baseline}. ` +
            `New violations were introduced.\n${guidance}\n${report(violations)}`
        );
    }
    if (violations.length < baseline) {
        expect.fail(
            `${name}: down to ${violations.length} violation(s) from a baseline of ${baseline}. ` +
            `Nice - now lower BASELINE to ${violations.length} in ${path.basename(__filename)} to lock the win in.`
        );
    }
}

describe("ScrollArea max-height placement", () => {
    /**
     * The Viewport is the element Radix gives `overflow-y: scroll`, and our wrapper sizes it
     * with `size-full`. A `height: 100%` cannot resolve against a parent that only carries a
     * max-height, so a max-h on the ScrollArea root does not constrain the scrolling element.
     * Whether that is visible depends on whether an ancestor clips, so the remaining cases need
     * a look in the browser before being rewritten - the baseline stops new ones meanwhile.
     *
     * The credential dialog was one of them, and it did not scroll at all once the SSH fields
     * grew. Fixed and the baseline lowered to match.
     *
     * Canonical form: *:data-[slot=scroll-area-viewport]:max-h-[...]
     */
    const BASELINE = 3;

    it("should not add new ScrollAreas with max-h on the root", () => {
        const violations = scan(collectTsx(SRC_DIR), (line) => {
            const opening = line.match(/<ScrollArea\s[^>]*className="([^"]*)"/);
            if (!opening) return false;
            const classes = opening[1];
            if (!/\bmax-h-/.test(classes)) return false;
            // A root max-h paired with a viewport max-h is the deliberate inherit pattern.
            if (/scroll-area-viewport\]?:max-h-/.test(classes)) return false;
            return true;
        });

        ratchet(
            "ScrollArea root max-h",
            violations,
            BASELINE,
            "Put the max-height on the viewport: *:data-[slot=scroll-area-viewport]:max-h-[...] " +
            "- see src/components/CLAUDE.md section 1."
        );
    });
});

describe("Dark mode color pairing", () => {
    /**
     * A raw palette color without a dark: counterpart is unreadable in the dark theme -
     * bg-green-100 with text-green-600 turns into near-invisible text on a light chip.
     * Semantic tokens (bg-muted, text-muted-foreground) are already theme-aware and are the
     * preferred fix; an explicit dark: variant is the fallback.
     */
    const BASELINE = 70;

    it("should not add new palette colors without a dark: counterpart", () => {
        const PALETTE =
            /(?<!dark:)\b(bg|text|border)-(red|green|blue|yellow|orange|amber|emerald|purple|pink|indigo|cyan|teal|lime|rose|violet|sky|fuchsia)-\d{2,3}\b/;

        const violations = scan(collectTsx(SRC_DIR), (line) => {
            const className = line.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
            if (!className) return false;
            const classes = className[1] ?? className[2] ?? "";
            return PALETTE.test(classes) && !classes.includes("dark:");
        });

        ratchet(
            "Palette color without dark: variant",
            violations,
            BASELINE,
            "Prefer a semantic token (bg-muted, text-muted-foreground), or pair the color with a " +
            "dark: variant - see src/components/CLAUDE.md section 5."
        );
    });
});
