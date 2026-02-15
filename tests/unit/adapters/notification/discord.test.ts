
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordAdapter } from '@/lib/adapters/notification/discord';

describe('Discord Adapter', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = mockFetch;
    });

    afterEach(() => {
         vi.restoreAllMocks();
    });

    it('should send test notification', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200
        });

        const result = await DiscordAdapter.test!({ webhookUrl: 'https://discord.com/api/webhooks/xxx' });

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith('https://discord.com/api/webhooks/xxx', expect.any(Object));
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.content).toContain('Connection Test');
    });

    it('should handle test failure', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found'
        });

        const result = await DiscordAdapter.test!({ webhookUrl: 'https://bad-url' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('404');
    });

    it('should send backup notification with embed', async () => {
        mockFetch.mockResolvedValue({ ok: true });

        const context = {
             title: 'Backup Successful',
             success: true,
             adapterName: 'MySQL Production',
             duration: 1500,
             size: 1048576, // 1MB
             jobName: 'Daily Backup',
             fields: [
                 { name: 'Adapter', value: 'MySQL Production', inline: true },
                 { name: 'Duration', value: '1500ms', inline: true },
                 { name: 'Size', value: '1 MB', inline: true },
             ],
        };

        await DiscordAdapter.send(
            { webhookUrl: 'url', username: 'Bot' },
            'Backup finished',
            context
        );

        expect(mockFetch).toHaveBeenCalled();
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.embeds).toHaveLength(1);
        expect(body.embeds[0].color).toBe(0x00ff00); // Green
        expect(body.embeds[0].title).toBe('Backup Successful');

        // Fields check
        const fields = body.embeds[0].fields;
        expect(fields).toEqual(expect.arrayContaining([
            { name: "Adapter", value: "MySQL Production", inline: true },
            { name: "Duration", value: "1500ms", inline: true },
            { name: "Size", value: expect.stringContaining("1 MB"), inline: true }
        ]));
    });

    it('should use Red color for failure', async () => {
        mockFetch.mockResolvedValue({ ok: true });

        await DiscordAdapter.send(
            { webhookUrl: 'url' },
            'Failed',
            { title: 'Backup Failed', success: false, error: 'Connection refused' }
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.embeds[0].color).toBe(0xff0000); // Red
        expect(body.embeds[0].title).toBe('Backup Failed');
        expect(body.embeds[0].description).toContain('Failed');
    });
});
