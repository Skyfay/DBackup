import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Security audit: no API route may serialise a *decrypted* adapter config back
 * to the client. This guards against re-introducing the secret-disclosure class
 * fixed in the adapter-listing endpoint (GHSA-cj5h-46h6-72wc follow-up).
 *
 * Rule: if a route assigns an identifier from `decryptConfig(...)` or
 * `resolveAdapterConfig(...)`, that identifier must never be passed (directly or
 * via spread) to `NextResponse.json(...)`. Routes may still use the decrypted
 * config server-side to derive non-secret data (db list, OAuth flow, redirects).
 */
describe('Security Audit: adapter secret disclosure', () => {
    const API_DIR = path.join(process.cwd(), 'src/app/api');

    function collectRouteFiles(dir: string): string[] {
        const out: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) out.push(...collectRouteFiles(full));
            else if (entry.isFile() && entry.name === 'route.ts') out.push(full);
        }
        return out;
    }

    const routeFiles = collectRouteFiles(API_DIR);

    it('finds API route files to scan', () => {
        expect(routeFiles.length).toBeGreaterThan(0);
    });

    routeFiles.forEach((file) => {
        const rel = path.relative(process.cwd(), file);
        const content = fs.readFileSync(file, 'utf-8');

        const usesDecrypt = /decryptConfig\s*\(|resolveAdapterConfig\s*\(/.test(content);
        if (!usesDecrypt) return;

        it(`${rel} does not serialise a decrypted config to the client`, () => {
            // Identifiers assigned from a decrypt/resolve call.
            const decryptedIdents = new Set<string>();
            const assignRe =
                /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:await\s+)?(?:[A-Za-z0-9_.]*\s*=\s*)?(?:.*?)(?:decryptConfig|resolveAdapterConfig)\s*\(/g;
            let m: RegExpExecArray | null;
            while ((m = assignRe.exec(content)) !== null) {
                decryptedIdents.add(m[1]);
            }

            for (const ident of decryptedIdents) {
                const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // NextResponse.json(ident) or NextResponse.json({ ...ident }) or NextResponse.json({ config: ident })
                const leakRe = new RegExp(
                    `NextResponse\\.json\\(\\s*(?:\\{[^}]*(?:\\.\\.\\.|:\\s*)${escaped}\\b|${escaped}\\b)`
                );
                expect(
                    leakRe.test(content),
                    `${rel} appears to pass decrypted config "${ident}" into NextResponse.json. ` +
                        `Return derived non-secret data or use toAdapterListItem/redactSecrets instead.`
                ).toBe(false);
            }
        });
    });

    it('the adapter-listing route uses the safe DTO (toAdapterListItem)', () => {
        const listRoute = path.join(API_DIR, 'adapters/route.ts');
        const content = fs.readFileSync(listRoute, 'utf-8');
        expect(content).toMatch(/toAdapterListItem/);
        // Must not hand-roll a raw decrypted response.
        expect(content).not.toMatch(/JSON\.stringify\(\s*decryptConfig/);
    });
});
