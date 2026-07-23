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
    const execFile = (cmd: string, args: string[], _opts: unknown, cb: (e: unknown, out: string, err: string) => void) => {
        Promise.resolve(execFileMock(cmd, args)).then(
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
