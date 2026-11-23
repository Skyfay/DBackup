
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Define the directory containing Server Actions
const ACTIONS_DIR = path.join(process.cwd(), 'src/app/actions');

describe('Security Audit: Server Actions', () => {
    // Recursively collect all .ts files in the actions directory
    function collectFiles(dir: string): string[] {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const result: string[] = [];
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                result.push(...collectFiles(full));
            } else if (entry.isFile() && entry.name.endsWith('.ts')) {
                result.push(full);
            }
        }
        return result;
    }
    const files = collectFiles(ACTIONS_DIR).map(f => path.relative(ACTIONS_DIR, f));

    files.forEach(file => {
        it(`File ${file} should implement Permission Checks`, () => {
            const filePath = path.join(ACTIONS_DIR, file);
            const content = fs.readFileSync(filePath, 'utf-8');

            // 1. Check if checkPermission is imported (skip if ALL functions are self-service)
            const hasImport = /import.*(checkPermission|checkPlatformAdmin).*from.*@\/lib\/auth\/access-control/.test(content);

            // 2. Count exported functions (rough estimation via regex)
            // Matches: export async function name(...)
            const exportedFunctionsMatch = content.match(/export\s+async\s+function\s+(\w+)/g);
            const exportedFunctionsCount = exportedFunctionsMatch ? exportedFunctionsMatch.length : 0;

            // 2b. Count functions marked as @no-permission-required (self-service)
            // These are functions where users can perform actions on their own data without admin permission
            const noPermissionRequiredMatch = content.match(/@no-permission-required/g);
            const noPermissionRequiredCount = noPermissionRequiredMatch ? noPermissionRequiredMatch.length : 0;

            // 3. Count checkPermission OR getUserPermissions calls
            // Some functions use complex logic (OR conditions) which checkPermission doesn't support directly.
            // So we accept getUserPermissions as a valid alternative, and checkPlatformAdmin, which is stricter.
            const permissionCallsMatch = content.match(/await\s+(checkPermission|checkPlatformAdmin|getUserPermissions|hasPermission)\(/g);
            const permissionCallsCount = permissionCallsMatch ? permissionCallsMatch.length : 0;

            // 4. Heuristic Assertion
            // Ideally, every exported function (entry point) needs a check.
            // This might produce false positives if internal helpers check it, or false negatives if one check covers multiple logics.
            // But strict 1:1 is a good starting policy for secure actions.
            // Functions marked with @no-permission-required are exempt (self-service actions).
            const requiredPermissionChecks = exportedFunctionsCount - noPermissionRequiredCount;
            if (requiredPermissionChecks > 0) {
                 // Only require checkPermission import if there are functions that need it
                 expect(hasImport, `File ${file} is missing import { checkPermission } from "@/lib/auth/access-control"`).toBe(true);
                 expect(permissionCallsCount,
                    `File ${file} exports ${exportedFunctionsCount} functions (${noPermissionRequiredCount} self-service) but only calls checkPermission ${permissionCallsCount} times. Ensure every public action is secured or marked with @no-permission-required.`
                ).toBeGreaterThanOrEqual(requiredPermissionChecks);
            }
        });
    });
});
