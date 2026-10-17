"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { pageAfterSwitch } from "@/components/layout/tenant-switch";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { ALL_TENANTS } from "@/lib/tenant/home";

/**
 * A session works in one tenant at a time, and every tab of the browser shares it. A tab that
 * switches says so on a channel, and the other tabs load their page again in the tenant opened
 * there, so none of them shows one tenant while it acts in another. The last switch is kept in the
 * storage of the browser too, for a tab that missed the message, which looks when it shows again.
 */

const log = logger.child({ component: "tenant-sync" });

const CHANNEL = "dbackup:tenant";
const LAST_SWITCH = "dbackup:tenant-switch";

/** A switch of the tenant, as one tab tells the others. */
export interface TenantSwitch {
    /** The tenant the session works in now, `ALL_TENANTS` for All tenants. */
    tenantId: string;
    name: string;
    /** The tab that switched, which never follows its own switch. */
    tab: string;
    /** When it switched, in milliseconds. */
    at: number;
}

/** What a tab knows of itself to judge a switch. */
export interface TabState {
    /** The tenant the tab shows, `ALL_TENANTS` for All tenants. */
    shown: string;
    /** Since when it shows that tenant. */
    since: number;
    /** The time of the last switch it followed. */
    handled: number;
}

/** This tab. Not `crypto.randomUUID`, which a DBackup served over plain HTTP lacks. */
const THIS_TAB = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function parseSwitch(value: unknown): TenantSwitch | null {
    if (!value || typeof value !== "object") return null;
    const entry = value as Partial<TenantSwitch>;
    const valid = typeof entry.tenantId === "string" && typeof entry.name === "string" && typeof entry.tab === "string" && typeof entry.at === "number";
    return valid ? (entry as TenantSwitch) : null;
}

function lastSwitch(): TenantSwitch | null {
    try {
        const stored = localStorage.getItem(LAST_SWITCH);
        return stored ? parseSwitch(JSON.parse(stored)) : null;
    } catch {
        return null;
    }
}

/**
 * Whether a tab follows a switch: one of another tab into another tenant, made after the tab
 * opened the tenant it shows and not followed yet.
 */
export function followsSwitch(entry: TenantSwitch | null, tab: TabState, ownTab = THIS_TAB): entry is TenantSwitch {
    if (!entry || entry.tab === ownTab) return false;
    if (entry.at <= tab.handled || entry.at < tab.since) return false;
    return entry.tenantId !== tab.shown;
}

/** Tells the other tabs that this one switched the session into a tenant, or into All tenants. */
export function announceTenantSwitch(tenantId: string, name: string) {
    const entry: TenantSwitch = { tenantId, name, tab: THIS_TAB, at: Date.now() };
    try {
        localStorage.setItem(LAST_SWITCH, JSON.stringify(entry));
    } catch {
        // A private window or blocked storage, the channel still reaches the open tabs.
    }
    if (typeof BroadcastChannel === "undefined") return;
    try {
        const channel = new BroadcastChannel(CHANNEL);
        channel.postMessage(entry);
        channel.close();
    } catch (error: unknown) {
        log.warn("Telling the other tabs about a switch of the tenant failed", { tenantId }, wrapError(error));
    }
}

/**
 * Follows a switch of the tenant made in another tab of this browser: says so and loads the page
 * again in that tenant, or the Overview from the page of a record the tenant does not hold.
 * Mounted once, by the head of the sidebar.
 */
export function TenantSync({ shown }: { shown: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const tab = useRef<TabState>({ shown, since: 0, handled: 0 });
    const path = useRef(pathname);

    useEffect(() => {
        path.current = pathname;
    }, [pathname]);

    useEffect(() => {
        tab.current.shown = shown;
        tab.current.since = Date.now();
    }, [shown]);

    useEffect(() => {
        const follow = (entry: TenantSwitch | null) => {
            if (!followsSwitch(entry, tab.current)) return;
            tab.current.handled = entry.at;
            toast.info(entry.tenantId === ALL_TENANTS ? "You see every tenant now, opened in another tab" : `You work in ${entry.name} now, opened in another tab`);
            const target = pageAfterSwitch(path.current);
            if (target) router.push(target);
            router.refresh();
        };
        const onShow = () => {
            if (document.visibilityState === "visible") follow(lastSwitch());
        };
        document.addEventListener("visibilitychange", onShow);
        const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
        if (channel) channel.onmessage = (event: MessageEvent) => follow(parseSwitch(event.data));
        return () => {
            document.removeEventListener("visibilitychange", onShow);
            channel?.close();
        };
    }, [router]);

    return null;
}
