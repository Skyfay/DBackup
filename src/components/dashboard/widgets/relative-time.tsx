"use client";

import { formatDistanceToNowStrict } from "date-fns";

interface RelativeTimeProps {
    date: Date | string;
    className?: string;
}

/**
 * "3 minutes ago" or "in 2 hours". The text depends on the moment it renders, so the server
 * and the browser can disagree by a minute and the hydration warning is suppressed.
 */
export function RelativeTime({ date, className }: RelativeTimeProps) {
    const value = typeof date === "string" ? new Date(date) : date;
    return (
        <time dateTime={value.toISOString()} className={className} suppressHydrationWarning>
            {formatDistanceToNowStrict(value, { addSuffix: true })}
        </time>
    );
}
