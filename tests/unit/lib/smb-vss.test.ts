/**
 * FSRVP handling for SMB shares.
 *
 * The expected output strings are taken from Samba's own `source3/rpcclient/cmd_fss.c`,
 * so a change in that format shows up here rather than as a backup that silently stops
 * using shadow copies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileMock = vi.fn();
vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('child_process')>();
    // Node's callback signature: the module under test wraps this itself.
    const execFile = (cmd: string, args: string[], opts: unknown, cb: (e: unknown, out: string, err: string) => void) => {
        Promise.resolve(execFileMock(cmd, args, opts)).then(
            (r: { stdout?: string; stderr?: string }) => cb(null, r?.stdout ?? "", r?.stderr ?? ""),
            (e: { stdout?: string; stderr?: string }) => cb(e, e?.stdout ?? "", e?.stderr ?? "")
        );
    };
    return { ...actual, default: { ...actual, execFile }, execFile };
});
vi.mock('@/lib/logging/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const {
    splitShareAddress,
    uncPath,
    probeSnapshotSupport,
    createShadowCopy,
    releaseShadowCopy,
    findOrphanedShadowCopies,
} = await import('@/lib/adapters/storage/smb-vss');

const CONFIG = { address: '//fileserver/data', username: 'backup', password: 's3cret', domain: 'CORP' };

/** Answers the nth rpcclient invocation, matched by the command it was given. */
function respond(map: Record<string, string>) {
    execFileMock.mockImplementation((_cmd: string, args: string[]) => {
        const commandIndex = args.indexOf('-c') + 1;
        const command = args[commandIndex] ?? '';
        const key = Object.keys(map).find((k) => command.startsWith(k));
        if (!key) return Promise.reject(Object.assign(new Error('unexpected command'), { stderr: `no stub for: ${command}` }));
        return Promise.resolve({ stdout: map[key], stderr: '' });
    });
}

beforeEach(() => {
    execFileMock.mockReset();
});

describe('splitShareAddress', () => {
    it('splits a POSIX-style share path', () => {
        expect(splitShareAddress('//fileserver/data')).toEqual({ host: 'fileserver', share: 'data' });
    });

    it('accepts the Windows spelling', () => {
        expect(splitShareAddress('\\\\fileserver\\data')).toEqual({ host: 'fileserver', share: 'data' });
    });

    it('drops a trailing slash', () => {
        expect(splitShareAddress('//fileserver/data/')).toEqual({ host: 'fileserver', share: 'data' });
    });

    it('rejects an address without a share name', () => {
        expect(() => splitShareAddress('//fileserver')).toThrow(/share name/i);
    });

    it('builds the UNC form FSRVP expects', () => {
        expect(uncPath('fileserver', 'data')).toBe('\\\\fileserver\\data');
    });
});

describe('probeSnapshotSupport', () => {
    it('reports support and the protocol version range', async () => {
        respond({
            fss_get_sup_version: 'server \\\\fileserver supports FSRVP versions from 1 to 1\n',
            fss_is_path_sup: 'UNC \\\\fileserver\\data supports shadow copy requests\n',
        });

        const result = await probeSnapshotSupport(CONFIG);

        expect(result.supported).toBe(true);
        expect(result.message).toContain('1-1');
    });

    it('reports a share the server cannot snapshot', async () => {
        respond({
            fss_get_sup_version: 'server \\\\fileserver supports FSRVP versions from 1 to 1\n',
            fss_is_path_sup: 'UNC \\\\fileserver\\data does not support shadow copy requests\n',
        });

        const result = await probeSnapshotSupport(CONFIG);

        expect(result.supported).toBe(false);
        expect(result.message).toMatch(/does not support/i);
    });

    it('turns an unreachable service into a negative answer instead of throwing', async () => {
        execFileMock.mockRejectedValue(Object.assign(new Error('fail'), { stderr: 'NT_STATUS_OBJECT_NAME_NOT_FOUND' }));

        const result = await probeSnapshotSupport(CONFIG);

        expect(result.supported).toBe(false);
        expect(result.message).toContain('NT_STATUS_OBJECT_NAME_NOT_FOUND');
    });

    it('hands rpcclient the password in PASSWD, never in its arguments, where the process table shows it', async () => {
        respond({ fss_get_sup_version: 'server versions from 1 to 2', fss_is_path_sup: 'UNC \\\\fileserver\\data supports shadow copy requests' });

        await probeSnapshotSupport(CONFIG);

        expect(execFileMock).toHaveBeenCalled();
        for (const [, args, opts] of execFileMock.mock.calls as [string, string[], { env: NodeJS.ProcessEnv }][]) {
            expect(args.join(' ')).not.toContain('s3cret');
            expect(args.slice(0, 2)).toEqual(['-U', 'CORP\\backup']);
            expect(args).not.toContain('-N');
            expect(opts.env.PASSWD).toBe('s3cret');
        }
    });

    it('asks for no password without one, and sends none the environment of DBackup carries', async () => {
        vi.stubEnv('PASSWD', 'not-for-the-share');
        try {
            respond({ fss_get_sup_version: 'server versions from 1 to 2', fss_is_path_sup: 'supports' });

            await probeSnapshotSupport({ address: '//fileserver/data', username: 'backup' });

            const [, args, opts] = execFileMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
            expect(args.slice(0, 3)).toEqual(['-U', 'backup', '-N']);
            expect(opts.env.PASSWD).toBeUndefined();
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it('never leaks the password into the message', async () => {
        execFileMock.mockRejectedValue(Object.assign(new Error('fail'), { stderr: 'auth failed for backup%s3cret' }));

        const result = await probeSnapshotSupport(CONFIG);

        expect(result.message).not.toContain('s3cret');
        expect(result.message).toContain('****');
    });
});

describe('createShadowCopy', () => {
    const EXPOSE_OUTPUT = [
        '13b4d6ca-3a4a-4a4b-8a3f-1c2d3e4f5a6b: shadow-copy set created',
        '13b4d6ca-3a4a-4a4b-8a3f-1c2d3e4f5a6b(9f8e7d6c-5b4a-3928-1716-0504f3e2d1c0): \\\\fileserver\\data shadow-copy added to set',
        '13b4d6ca-3a4a-4a4b-8a3f-1c2d3e4f5a6b: prepare completed in 2 secs',
        '13b4d6ca-3a4a-4a4b-8a3f-1c2d3e4f5a6b: commit completed in 1 secs',
        '13b4d6ca-3a4a-4a4b-8a3f-1c2d3e4f5a6b(9f8e7d6c-5b4a-3928-1716-0504f3e2d1c0): share \\\\fileserver\\data@{9f8e7d6c} exposed as a snapshot of \\\\fileserver\\data',
        '',
    ].join('\n');

    it('returns a handle pointing at the exposed share', async () => {
        respond({ fss_create_expose: EXPOSE_OUTPUT, fss_recovery_complete: 'marked recovery complete\n' });

        const handle = await createShadowCopy(CONFIG);

        expect(handle.configOverride.address).toBe('//fileserver/data@{9f8e7d6c}');
        expect(handle.id).toContain('13b4d6ca-3a4a-4a4b-8a3f-1c2d3e4f5a6b');
        expect(handle.id).toContain('9f8e7d6c-5b4a-3928-1716-0504f3e2d1c0');
    });

    it('marks the set recovery-complete, or the server deletes it after 180 seconds', async () => {
        // MS-FSRVP 3.1.5.7: when the Message Sequence Timer elapses the server deletes
        // every set whose status is not "Recovered", and RecoveryComplete is what stops
        // that timer. Without this call a Windows server pulls the snapshot away mid-backup.
        respond({ fss_create_expose: EXPOSE_OUTPUT, fss_recovery_complete: 'marked recovery complete\n' });

        await createShadowCopy(CONFIG);

        const commands = execFileMock.mock.calls.map((c) => c[1][c[1].indexOf('-c') + 1]);
        expect(commands.some((c: string) => c.startsWith('fss_recovery_complete 13b4d6ca'))).toBe(true);
    });

    it('uses the file-share backup context, read-only', async () => {
        respond({ fss_create_expose: EXPOSE_OUTPUT, fss_recovery_complete: 'ok\n' });

        await createShadowCopy(CONFIG);

        const created = execFileMock.mock.calls
            .map((c) => c[1][c[1].indexOf('-c') + 1])
            .find((c: string) => c.startsWith('fss_create_expose'));
        expect(created).toContain('file_share_backup');
        expect(created).toContain(' ro ');
    });

    it('refuses an exposed share that is no share address, and releases the snapshot again', async () => {
        // The server names the share the backup reads, so it is held to the form of a configured one.
        const odd = EXPOSE_OUTPUT.replace('share \\\\fileserver\\data@{9f8e7d6c} exposed', 'share -L exposed');
        respond({ fss_create_expose: odd, fss_recovery_complete: 'ok\n', fss_delete: '' });

        await expect(createShadowCopy(CONFIG)).rejects.toThrow(/no share address/);

        const commands = execFileMock.mock.calls.map((c) => c[1][c[1].indexOf('-c') + 1]);
        expect(commands.some((c: string) => c.startsWith('fss_delete'))).toBe(true);
        expect(commands.some((c: string) => c.startsWith('fss_recovery_complete'))).toBe(false);
    });

    it('releases the snapshot again when it cannot be marked recovery-complete', async () => {
        // Better none than one the server removes while the backup reads from it.
        execFileMock.mockImplementation((_cmd: string, args: string[]) => {
            const command = args[args.indexOf('-c') + 1] ?? '';
            if (command.startsWith('fss_create_expose')) return Promise.resolve({ stdout: EXPOSE_OUTPUT, stderr: '' });
            if (command.startsWith('fss_recovery_complete')) return Promise.reject(Object.assign(new Error('fail'), { stderr: 'FSRVP_E_BAD_STATE' }));
            return Promise.resolve({ stdout: '', stderr: '' });
        });

        await expect(createShadowCopy(CONFIG)).rejects.toThrow(/FSRVP_E_BAD_STATE/);

        const commands = execFileMock.mock.calls.map((c) => c[1][c[1].indexOf('-c') + 1]);
        expect(commands.some((c: string) => c.startsWith('fss_delete'))).toBe(true);
    });

    it('fails clearly when the response carries no exposed path', async () => {
        respond({ fss_create_expose: 'something went sideways\n' });

        await expect(createShadowCopy(CONFIG)).rejects.toThrow(/exposed snapshot path/i);
    });
});

describe('releaseShadowCopy', () => {
    const handle = { id: 'set-1|copy-1|\\\\fileserver\\data', configOverride: {}, label: 'snap' };

    it('passes base share and both ids, in that order', async () => {
        respond({ fss_delete: 'shadow-copy deleted\n' });

        await releaseShadowCopy(CONFIG, handle);

        const command = execFileMock.mock.calls[0][1][execFileMock.mock.calls[0][1].indexOf('-c') + 1];
        expect(command).toBe('fss_delete \\\\fileserver\\data set-1 copy-1');
    });

    it('treats an already-gone snapshot as released', async () => {
        execFileMock.mockRejectedValue(Object.assign(new Error('fail'), { stderr: 'FSRVP_E_SHADOWCOPYSET_ID_MISMATCH' }));

        await expect(releaseShadowCopy(CONFIG, handle)).resolves.toBeUndefined();
    });

    it('surfaces any other failure, so cleanup can report it', async () => {
        execFileMock.mockRejectedValue(Object.assign(new Error('fail'), { stderr: 'NT_STATUS_ACCESS_DENIED' }));

        await expect(releaseShadowCopy(CONFIG, handle)).rejects.toThrow(/ACCESS_DENIED/);
    });
});

describe('findOrphanedShadowCopies', () => {
    it('reports a leftover snapshot with the ids needed to release it', async () => {
        respond({
            fss_has_shadow_copy: 'UNC \\\\fileserver\\data has an associated shadow-copy with compatibility 0x0\n',
            fss_get_mapping: 'aaaaaaaa-1111-2222-3333-444444444444(bbbbbbbb-5555-6666-7777-888888888888): share \\\\fileserver\\data@old is a shadow-copy of \\\\fileserver\\data at 2026-07-23\n',
        });

        const orphans = await findOrphanedShadowCopies(CONFIG);

        expect(orphans).toHaveLength(1);
        expect(orphans[0].id).toBe('aaaaaaaa-1111-2222-3333-444444444444|bbbbbbbb-5555-6666-7777-888888888888|\\\\fileserver\\data');
    });

    it('reports none when the share is clean', async () => {
        respond({ fss_has_shadow_copy: 'UNC \\\\fileserver\\data does not have an associated shadow-copy\n' });

        expect(await findOrphanedShadowCopies(CONFIG)).toEqual([]);
    });

    it('reports none rather than throwing when the server cannot be asked', async () => {
        execFileMock.mockRejectedValue(Object.assign(new Error('fail'), { stderr: 'timeout' }));

        expect(await findOrphanedShadowCopies(CONFIG)).toEqual([]);
    });
});

/**
 * rpcclient splits its `-c` line into commands at every semicolon and each command into words at
 * whitespace and quotes. A server, a share or an id holding one of them would pass more arguments
 * or run another command, so rpcclient never runs with it, whatever the form or the server said.
 */
describe('words rpcclient would read as part of its command', () => {
    const BROKEN = [
        '//fileserver/data;fss_delete \\\\fileserver\\data a b',
        '//fileserver/da"ta',
        "//fileserver/da'ta",
        '//fileserver/My Share',
        '//fileserver/da\nta',
        '//file;server/data',
        '//fileserver/data/sub;dir',
    ];

    it('runs no rpcclient for an address with one, and says why', async () => {
        respond({ fss_get_sup_version: 'ok\n', fss_is_path_sup: 'supports\n', fss_has_shadow_copy: 'has an associated shadow-copy\n' });

        for (const address of BROKEN) {
            const probe = await probeSnapshotSupport({ ...CONFIG, address });
            expect(probe.supported, JSON.stringify(address)).toBe(false);
            expect(probe.message).toMatch(/without whitespace, semicolons, quotes or control characters/);
            await expect(createShadowCopy({ ...CONFIG, address })).rejects.toThrow(/without whitespace/);
            expect(await findOrphanedShadowCopies({ ...CONFIG, address })).toEqual([]);
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it('runs no rpcclient to release a handle whose share or ids hold one', async () => {
        respond({ fss_delete: 'shadow-copy deleted\n' });

        for (const id of ['set-1|copy-1|\\\\fileserver\\data;fss_delete x y z', 'set-1;x|copy-1|\\\\fileserver\\data', 'set-1|copy 1|\\\\fileserver\\data']) {
            await expect(releaseShadowCopy(CONFIG, { id, configOverride: {}, label: 'snap' })).rejects.toThrow(/without whitespace/);
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it('runs no rpcclient for a server, a share or an id that starts with a hyphen, which it would read as an option', async () => {
        respond({ fss_get_sup_version: 'ok\n', fss_is_path_sup: 'supports\n', fss_delete: 'shadow-copy deleted\n' });

        for (const address of ['//fileserver/-data', '//fileserver/data/-sub']) {
            const probe = await probeSnapshotSupport({ ...CONFIG, address });
            expect(probe.supported, address).toBe(address === '//fileserver/data/-sub');
        }
        execFileMock.mockClear();
        expect((await probeSnapshotSupport({ ...CONFIG, address: '//fileserver/-data' })).message).toMatch(/do not start with a hyphen/);
        await expect(createShadowCopy({ ...CONFIG, address: '//fileserver/-data' })).rejects.toThrow(/do not start with a hyphen/);
        await expect(releaseShadowCopy(CONFIG, { id: 'set-1|-copy|\\\\fileserver\\data', configOverride: {}, label: 'snap' })).rejects.toThrow(/do not start with a hyphen/);
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it('runs no rpcclient for an address of another form than //server/share', async () => {
        respond({ fss_get_sup_version: 'ok\n', fss_is_path_sup: 'supports\n' });

        for (const address of ['/fileserver/data', 'fileserver/data', '///fileserver/data']) {
            const probe = await probeSnapshotSupport({ ...CONFIG, address });
            expect(probe.supported, address).toBe(false);
            await expect(createShadowCopy({ ...CONFIG, address })).rejects.toThrow(/of the form \/\/server\/share|without whitespace/);
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });
});

describe('the server rpcclient dials', () => {
    it('is the server of the address the local network check of a tenant saw, looked up in DNS alone', async () => {
        respond({ fss_get_sup_version: 'versions from 1 to 2\n', fss_is_path_sup: 'UNC \\\\fileserver\\data supports shadow copy requests\n' });

        await probeSnapshotSupport(CONFIG);

        expect(execFileMock).toHaveBeenCalled();
        for (const [, args] of execFileMock.mock.calls as [string, string[]][]) {
            expect(args.at(-1)).toBe('fileserver');
            expect(args).toContain('--option=name resolve order=host');
        }
    });

    it('runs no rpcclient for a server it would read as a binding string or with a NetBIOS name type', async () => {
        respond({ fss_get_sup_version: 'ok\n', fss_is_path_sup: 'supports\n' });

        // rpcclient dials 10.0.0.9 on port 135 for the first and strips `#20` from the second.
        for (const address of ['//ncacn_ip_tcp:10.0.0.9[135]/data', '//10.0.0.9#20/data', '//[fd00::9]/data']) {
            expect((await probeSnapshotSupport({ ...CONFIG, address })).supported, address).toBe(false);
            await expect(createShadowCopy({ ...CONFIG, address })).rejects.toThrow(/of the form \/\/server\/share/);
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });
});

describe('a % in the login rpcclient takes', () => {
    // rpcclient reads `-U domain\user%secret` as the password, which wins over PASSWD, and the
    // domain is part of the same argument, checked against Samba 4.22.
    it.each([
        ['the user name', { username: 'backup%guess' }],
        ['the domain', { domain: 'CORP%guess' }],
    ])('runs no rpcclient for %s', async (_case, login) => {
        respond({ fss_get_sup_version: 'ok\n', fss_is_path_sup: 'supports\n', fss_create_expose: 'ok\n' });

        expect((await probeSnapshotSupport({ ...CONFIG, ...login })).supported).toBe(false);
        await expect(createShadowCopy({ ...CONFIG, ...login })).rejects.toThrow(/cannot hold a %/);
        expect(execFileMock).not.toHaveBeenCalled();
    });
});
