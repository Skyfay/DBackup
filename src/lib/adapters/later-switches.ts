/**
 * Switches of a connection that came after connections were saved without them, where the missing
 * value means the behaviour from before and a new connection gets a safer one. A plain module, the
 * adapter, the create of a connection and the connection form read it.
 *
 * - The adapter reads a missing value as the behaviour from before, so no stored connection changes.
 * - `createAdapter` stores the value of today for a new connection that leaves the switch out, like
 *   a request of the API, so only a connection saved before the switch keeps the old behaviour.
 * - The form of a saved connection without the switch shows what the adapter does with it, so a
 *   save of an unrelated change never turns it over.
 */

type Config = Record<string, unknown>;

interface LaterSwitch {
    /** The value a new connection gets when it leaves the switch out. */
    fresh: boolean;
    /** What a connection saved without the switch does, shown in its form. */
    saved: (config: Config) => boolean;
}

/**
 * FTP: before `trustServerCertificate` DBackup accepted every certificate of an FTPS server, a
 * connection without TLS has no certificate to trust.
 */
const LATER_SWITCHES: Readonly<Record<string, Readonly<Record<string, LaterSwitch>>>> = {
    ftp: {
        trustServerCertificate: { fresh: false, saved: (config) => config.tls === true },
    },
};

/** Whether an FTP connection accepts any certificate of its server, also one saved before the switch existed. */
export function trustsFtpCertificate(config: { trustServerCertificate?: unknown }): boolean {
    // Missing on a connection saved earlier, which accepted every certificate.
    return config.trustServerCertificate !== false;
}

/** A config of a new connection with the value of today for every later switch it leaves out. */
export function withFreshSwitches(adapterId: string, config: Config): Config {
    const switches = Object.hasOwn(LATER_SWITCHES, adapterId) ? LATER_SWITCHES[adapterId] : {};
    const filled = { ...config };
    for (const [key, entry] of Object.entries(switches)) {
        if (filled[key] === undefined) filled[key] = entry.fresh;
    }
    return filled;
}

/** The value a form shows for a later switch a saved config lacks, undefined for any other key. */
export function savedSwitchValue(adapterId: string, key: string, config: Config): boolean | undefined {
    const switches = Object.hasOwn(LATER_SWITCHES, adapterId) ? LATER_SWITCHES[adapterId] : {};
    return Object.hasOwn(switches, key) ? switches[key].saved(config) : undefined;
}
