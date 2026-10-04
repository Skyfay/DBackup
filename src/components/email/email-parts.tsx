import * as React from "react";
import type { NotificationDestination, NotificationProblem, NotificationTone } from "@/lib/notifications/types";
import { assetUrl, type MutedIcon } from "./email-icons";
import { LIGHT, MONO, toneColors } from "./email-theme";

/**
 * The parts of a notification mail. Tables and inline styles only, since mail clients drop
 * most of CSS, every color light inline and dark through a class from `darkModeCss`.
 */

const c = LIGHT;

export const TABLE: React.TableHTMLAttributes<HTMLTableElement> = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0, width: "100%" };

/** A picture with its dark twin, which the dark mode shows instead. Outlook never shows the twin. */
export function ThemedImage({ light, dark, size }: { light: string; dark: string; size: number }) {
    const base: React.CSSProperties = { border: 0, outline: "none", verticalAlign: "middle" };
    const hidden = { ...base, display: "none", maxHeight: 0, overflow: "hidden", msoHide: "all" } as React.CSSProperties;
    return (
        <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="m-light" src={light} width={size} height={size} alt="" style={{ ...base, display: "inline-block" }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="m-dark" src={dark} width={size} height={size} alt="" style={hidden} />
        </>
    );
}

function MutedImage({ icon, size }: { icon: MutedIcon; size: number }) {
    return <ThemedImage light={assetUrl.muted(icon, "light")} dark={assetUrl.muted(icon, "dark")} size={size} />;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="m-fg" style={{ fontSize: 13, fontWeight: 600, color: c.fg, paddingBottom: 8 }}>{children}</div>;
}

export function Banner({ tone, icon, title, message }: { tone: NotificationTone; icon: { light: string; dark: string }; title: string; message: string }) {
    const t = toneColors(tone, false);
    return (
        <table {...TABLE} className={`m-banner-${tone}`} style={{ borderCollapse: "separate", backgroundColor: t.tint, border: `1px solid ${t.tintBorder}`, borderRadius: 14 }}>
            <tbody>
                <tr>
                    <td className={`m-bar-${tone}`} width={4} style={{ width: 4, backgroundColor: t.bar, borderRadius: "13px 0 0 13px", fontSize: 0, lineHeight: 0 }}>&nbsp;</td>
                    <td style={{ padding: "18px 20px 18px 16px" }}>
                        <table {...TABLE}>
                            <tbody>
                                <tr>
                                    <td width={36} valign="top" style={{ width: 36 }}>
                                        <table role="presentation" cellPadding={0} cellSpacing={0} border={0} className={`m-icon-${tone}`} style={{ width: 36, height: 36, backgroundColor: t.tile, borderRadius: 10 }}>
                                            <tbody>
                                                <tr>
                                                    <td align="center" valign="middle" style={{ width: 36, height: 36, lineHeight: 0 }}>
                                                        <ThemedImage light={icon.light} dark={icon.dark} size={18} />
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </td>
                                    <td valign="top" style={{ paddingLeft: 14 }}>
                                        <div className="m-fg" style={{ fontSize: 17, fontWeight: 600, lineHeight: "23px", letterSpacing: "-0.01em", color: c.fg }}>{title}</div>
                                        <div className="m-muted" style={{ paddingTop: 3, fontSize: 14, lineHeight: "21px", color: c.muted }}>{message}</div>
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

/** The tiles of the strip: the label above, the value below, like the strips of the app. */
export function Stats({ stats }: { stats: Array<{ label: string; value: string }> }) {
    const width = `${Math.floor(100 / stats.length)}%`;
    return (
        <table {...TABLE}>
            <tbody>
                <tr>
                    {stats.map((stat, i) => (
                        <td key={stat.label} className="m-stat" width={width} valign="top" style={{ width, paddingRight: i < stats.length - 1 ? 8 : 0 }}>
                            <div className="m-tile" style={{ backgroundColor: c.tile, borderRadius: 10, padding: "9px 12px" }}>
                                <div className="m-muted" style={{ fontSize: 12, lineHeight: "17px", color: c.muted }}>{stat.label}</div>
                                <div className="m-fg" style={{ paddingTop: 1, fontSize: 15, lineHeight: "21px", fontWeight: 600, color: c.fg }}>{stat.value}</div>
                            </div>
                        </td>
                    ))}
                </tr>
            </tbody>
        </table>
    );
}

export function Usage({ percent, label, aside }: { percent: number; label: string; aside: string }) {
    const t = toneColors("warning", false);
    const filled = Math.max(1, Math.min(100, Math.round(percent)));
    return (
        <>
            <table {...TABLE}>
                <tbody>
                    <tr>
                        <td className="m-fg" style={{ fontSize: 13, fontWeight: 600, color: c.fg, paddingBottom: 10 }}>{label}</td>
                        <td className="m-muted" align="right" style={{ fontSize: 12, color: c.muted, paddingBottom: 10 }}>{aside}</td>
                    </tr>
                </tbody>
            </table>
            <table {...TABLE} style={{ borderCollapse: "separate" }}>
                <tbody>
                    <tr>
                        <td className="m-fill-warning" width={`${filled}%`} style={{ height: 8, backgroundColor: t.accent, borderRadius: filled === 100 ? 999 : "999px 0 0 999px", fontSize: 0, lineHeight: 0 }}>&nbsp;</td>
                        {filled < 100 && (
                            <td className="m-track" style={{ height: 8, backgroundColor: c.track, borderRadius: "0 999px 999px 0", fontSize: 0, lineHeight: 0 }}>&nbsp;</td>
                        )}
                    </tr>
                </tbody>
            </table>
        </>
    );
}

export function Code({ children }: { children: string }) {
    return (
        <div className="m-code" style={{ backgroundColor: c.code, borderRadius: 8, padding: "10px 12px", fontFamily: MONO, fontSize: 12, lineHeight: "19px", color: c.fg, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {children}
        </div>
    );
}

/** A title as a sentence, with its period. */
export function sentence(text: string): string {
    return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function Problem({ problem }: { problem: NotificationProblem }) {
    return (
        <>
            <SectionLabel>What went wrong</SectionLabel>
            <div className="m-fg2" style={{ fontSize: 14, lineHeight: "21px", color: c.fg2 }}>{sentence(problem.title)}</div>
            {problem.help && <div className="m-muted" style={{ paddingTop: 2, fontSize: 13, lineHeight: "20px", color: c.muted }}>{problem.help}</div>}
            <div style={{ paddingTop: 10 }}>
                <Code>{problem.raw}</Code>
            </div>
            {problem.where && <div className="m-muted" style={{ paddingTop: 8, fontSize: 12, color: c.muted }}>{problem.where}</div>}
        </>
    );
}

export function Destinations({ destinations }: { destinations: NotificationDestination[] }) {
    return (
        <>
            <SectionLabel>Destinations</SectionLabel>
            <table {...TABLE}>
                <tbody>
                    {destinations.map((dest, i) => {
                        const logo = { light: assetUrl.adapter(dest.adapterId, "light"), dark: assetUrl.adapter(dest.adapterId, "dark") };
                        const line = i > 0 ? `1px solid ${c.border}` : "none";
                        return (
                            <React.Fragment key={`${dest.name}-${i}`}>
                                <tr>
                                    <td className="m-line" width={28} valign="middle" style={{ width: 28, padding: "9px 0", borderTop: line, lineHeight: 0 }}>
                                        {logo.light && logo.dark ? <ThemedImage light={logo.light} dark={logo.dark} size={18} /> : null}
                                    </td>
                                    <td className="m-fg m-line" valign="middle" style={{ padding: "9px 0", borderTop: line, fontSize: 14, fontWeight: 500, color: c.fg }}>{dest.name}</td>
                                    <td className={`${dest.state === "failed" ? "m-red" : "m-muted"} m-line`} align="right" valign="middle" style={{ padding: "9px 0", borderTop: line, fontSize: 13, color: dest.state === "failed" ? c.destructiveText : c.muted, whiteSpace: "nowrap" }}>
                                        {dest.detail}&nbsp;&nbsp;
                                        <ThemedImage light={assetUrl.state(dest.state, "light")} dark={assetUrl.state(dest.state, "dark")} size={15} />
                                    </td>
                                </tr>
                                {dest.error && (
                                    <tr>
                                        <td colSpan={3} style={{ padding: "0 0 8px 28px" }}>
                                            <Code>{dest.error}</Code>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </>
    );
}

export function Note({ children }: { children: string }) {
    return (
        <table {...TABLE} className="m-tile" style={{ backgroundColor: c.tile, borderRadius: 10 }}>
            <tbody>
                <tr>
                    <td width={30} valign="top" style={{ width: 30, padding: "12px 0 12px 14px", lineHeight: 0 }}>
                        <MutedImage icon="shield-check" size={16} />
                    </td>
                    <td className="m-fg2" style={{ padding: "12px 14px 12px 0", fontSize: 13, lineHeight: "20px", color: c.fg2 }}>{children}</td>
                </tr>
            </tbody>
        </table>
    );
}

export function Details({ rows }: { rows: Array<{ name: string; value: string }> }) {
    return (
        <table {...TABLE}>
            <tbody>
                {rows.map((row, i) => {
                    const line = i > 0 ? `1px solid ${c.border}` : "none";
                    return (
                        <tr key={`${row.name}-${i}`}>
                            <td className="m-muted m-line" width={128} valign="top" style={{ width: 128, padding: "9px 12px 9px 0", borderTop: line, fontSize: 13, lineHeight: "19px", color: c.muted }}>{row.name}</td>
                            <td className="m-fg m-line" valign="top" style={{ padding: "9px 0", borderTop: line, fontSize: 13, lineHeight: "19px", fontWeight: 500, color: c.fg, wordBreak: "break-word" }}>{row.value}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

export interface MailButton {
    label: string;
    href: string;
    icon: MutedIcon | null;
}

/** The buttons, outline like View logs on the Overview, each with the icon of the page it opens. */
export function Buttons({ buttons }: { buttons: MailButton[] }) {
    return (
        <table role="presentation" cellPadding={0} cellSpacing={0} border={0}>
            <tbody>
                <tr>
                    {buttons.map((button) => (
                        <td key={button.label} style={{ paddingRight: 8 }}>
                            <a className="m-btn" href={button.href} style={{ display: "inline-block", backgroundColor: c.buttonBg, border: `1px solid ${c.buttonBorder}`, borderRadius: 8, padding: "8px 14px 8px 12px", color: c.fg, fontSize: 14, lineHeight: "18px", fontWeight: 500, textDecoration: "none", whiteSpace: "nowrap" }}>
                                {button.icon && (
                                    <span style={{ paddingRight: 8 }}>
                                        <MutedImage icon={button.icon} size={16} />
                                    </span>
                                )}
                                {button.label}
                            </a>
                        </td>
                    ))}
                </tr>
            </tbody>
        </table>
    );
}
