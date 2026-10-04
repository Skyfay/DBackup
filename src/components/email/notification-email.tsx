import * as React from "react";
import type { NotificationPayload, NotificationTone } from "@/lib/notifications/types";
import type { NotificationBrand } from "@/lib/notifications/brand";
import { formatterFor } from "@/lib/notifications/templates/format";
import { assetUrl, bannerIcon, EMAIL_LOGO, isMutedIcon } from "./email-icons";
import { LIGHT, SANS } from "./email-theme";
import { Banner, Buttons, Destinations, Details, Note, Problem, Stats, TABLE, Usage, type MailButton } from "./email-parts";

/**
 * The mail every notification sends through an Email (SMTP) channel: a banner in the color of
 * its status like the one of the Overview, a card with the tiles, what went wrong, the
 * destinations and the facts, the buttons into DBackup, and why the reader gets it.
 */

const c = LIGHT;

export function toneOf(payload: NotificationPayload): NotificationTone {
    return payload.tone ?? (payload.success ? "success" : "failure");
}

/** A path of the app as a link from outside, or null when the instance has no address to link to. */
export function absoluteHref(href: string, baseUrl: string | null): string | null {
    if (/^https?:\/\//i.test(href)) return href;
    return baseUrl ? `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}` : null;
}

/** The facts under the tiles: the details of the payload, or its fields without what the tiles show. */
export function detailsOf(payload: NotificationPayload): Array<{ name: string; value: string }> {
    if (payload.details) return payload.details;
    const shown = new Set((payload.stats ?? []).map((stat) => stat.label.toLowerCase()));
    return (payload.fields ?? []).filter((field) => !shown.has(field.name.toLowerCase())).map(({ name, value }) => ({ name, value }));
}

function hostOf(baseUrl: string | null): string | null {
    if (!baseUrl) return null;
    try {
        return new URL(baseUrl).host;
    } catch {
        return null;
    }
}

export function NotificationEmail({ payload, brand }: { payload: NotificationPayload; brand: NotificationBrand }) {
    const tone = toneOf(payload);
    const icon = bannerIcon(payload.icon, tone);
    const when = formatterFor({ timeZone: brand.timeZone }).date(payload.timestamp);
    const details = detailsOf(payload);
    const buttons: MailButton[] = [];
    for (const action of (payload.actions ?? []).slice(0, 2)) {
        const href = absoluteHref(action.href, brand.baseUrl);
        if (href) buttons.push({ label: action.label, href, icon: isMutedIcon(action.icon) ? action.icon : null });
    }
    const host = hostOf(brand.baseUrl);

    const sections: React.ReactNode[] = [];
    if (payload.stats && payload.stats.length > 0) sections.push(<Stats key="stats" stats={payload.stats.slice(0, 4)} />);
    if (payload.usage) sections.push(<Usage key="usage" {...payload.usage} />);
    if (payload.problem && !payload.destinations?.some((dest) => dest.error)) sections.push(<Problem key="problem" problem={payload.problem} />);
    if (payload.destinations && payload.destinations.length > 0) sections.push(<Destinations key="destinations" destinations={payload.destinations} />);
    if (payload.note) sections.push(<Note key="note">{payload.note}</Note>);
    if (details.length > 0) sections.push(<Details key="details" rows={details} />);

    return (
        <table {...TABLE} className="m-page" style={{ backgroundColor: c.page }}>
            <tbody>
                <tr>
                    <td align="center" style={{ padding: "28px 16px" }}>
                        <table {...TABLE} style={{ maxWidth: 560, fontFamily: SANS }}>
                            <tbody>
                                <tr>
                                    <td style={{ paddingBottom: 16 }}>
                                        <table {...TABLE}>
                                            <tbody>
                                                <tr>
                                                    <td valign="middle" style={{ fontSize: 14, lineHeight: "22px" }}>
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={EMAIL_LOGO} width={22} height={22} alt="" style={{ border: 0, verticalAlign: "middle", borderRadius: 4 }} />
                                                        <span className="m-fg" style={{ paddingLeft: 9, fontWeight: 600, color: c.fg, verticalAlign: "middle" }}>DBackup</span>
                                                        {brand.instanceName && <span className="m-muted" style={{ color: c.muted, verticalAlign: "middle" }}>&nbsp;· {brand.instanceName}</span>}
                                                    </td>
                                                    {when && <td className="m-muted m-wide" align="right" valign="middle" style={{ fontSize: 12, color: c.muted, whiteSpace: "nowrap" }}>{when}</td>}
                                                </tr>
                                            </tbody>
                                        </table>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <Banner
                                            tone={tone}
                                            icon={{ light: assetUrl.banner(icon, tone, "light"), dark: assetUrl.banner(icon, tone, "dark") }}
                                            title={payload.title}
                                            message={payload.message}
                                        />
                                    </td>
                                </tr>
                                {sections.length > 0 && (
                                    <tr>
                                        <td style={{ paddingTop: 12 }}>
                                            <table {...TABLE} className="m-card" style={{ borderCollapse: "separate", backgroundColor: c.card, border: `1px solid ${c.border}`, borderRadius: 14 }}>
                                                <tbody>
                                                    {sections.map((section, i) => (
                                                        <tr key={i}>
                                                            <td className="m-pad" style={{ padding: `${i === 0 ? 20 : 18}px 20px ${i === sections.length - 1 ? 20 : 0}px` }}>{section}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </td>
                                    </tr>
                                )}
                                {buttons.length > 0 && (
                                    <tr>
                                        <td style={{ paddingTop: 16 }}>
                                            <Buttons buttons={buttons} />
                                        </td>
                                    </tr>
                                )}
                                <tr>
                                    <td className="m-muted" style={{ padding: "24px 4px 0", fontSize: 12, lineHeight: "19px", color: c.muted }}>
                                        {payload.reason && <div>{payload.reason}</div>}
                                        <div className="m-faint" style={{ paddingTop: payload.reason ? 6 : 0, color: c.faint }}>
                                            DBackup{brand.instanceName ? ` · ${brand.instanceName}` : ""}
                                            {host && brand.baseUrl && (
                                                <>
                                                    {" · "}
                                                    <a className="m-muted" href={brand.baseUrl} style={{ color: c.muted, textDecoration: "underline" }}>{host}</a>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </td>
                </tr>
            </tbody>
        </table>
    );
}
