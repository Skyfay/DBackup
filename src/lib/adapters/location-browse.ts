/**
 * The storage adapters whose folder can be picked in a browser in the connection form, before the
 * connection is saved, and where that browser starts. A plain module, since the form and the
 * server both read it.
 */
export interface LocationBrowse {
    /** The folder the adapter lists from while browsing, in place of the one in the form. */
    root: string;
    /** Whether the field takes the folder with a leading slash, like an SFTP path, or without, like an S3 prefix. */
    rooted: boolean;
}

const FROM_THE_TOP: LocationBrowse = { root: "/", rooted: true };
const WITHIN: LocationBrowse = { root: "", rooted: false };

const LOCATION_BROWSE: Record<string, LocationBrowse> = {
    // A bucket has no folders of its own, its prefixes are listed from the top of the bucket.
    "s3-generic": WITHIN,
    "s3-aws": WITHIN,
    "s3-r2": WITHIN,
    "s3-hetzner": WITHIN,
    // The folder of a share lies within it, like the collection of a WebDAV URL.
    smb: WITHIN,
    webdav: WITHIN,
    // A server is browsed from its top, which a chrooted login sees as its own.
    sftp: FROM_THE_TOP,
    ftp: FROM_THE_TOP,
    rsync: FROM_THE_TOP,
};

/** How the folder of an adapter is browsed, or null for one whose folder is typed or picked another way. */
export function locationBrowseOf(adapterId: string): LocationBrowse | null {
    return LOCATION_BROWSE[adapterId] ?? null;
}

/** The folder a browser picked, "/" and the names on the way, in the form the field of the adapter takes. */
export function locationValue(browse: LocationBrowse, picked: string): string {
    const names = picked.split("/").filter(Boolean).join("/");
    return browse.rooted ? `/${names}` : names;
}
