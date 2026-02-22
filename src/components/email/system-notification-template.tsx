import * as React from "react";

const LOGO_URL = "https://dbackup.app/logo.png";

/**
 * Shadcn/UI-inspired email notification template.
 *
 * Uses inline styles only (HTML email compatibility).
 * Follows the Shadcn/UI design system:
 *   - zinc color palette for neutrals
 *   - clean card layout with subtle borders
 *   - status indicators via colored accents
 *   - consistent typography hierarchy
 */

interface SystemNotificationEmailProps {
  title: string;
  message: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  color?: string;
  success: boolean;
  /** Override the auto-detected badge label (e.g. "Alert") */
  badge?: string;
}

/* ── Design tokens (Shadcn zinc palette) ─────────────────────── */
const tokens = {
  bg: "#ffffff",
  bgMuted: "#fafafa",
  bgSubtle: "#f4f4f5",
  foreground: "#09090b",
  foregroundMuted: "#71717a",
  foregroundLight: "#a1a1aa",
  border: "#e4e4e7",
  borderLight: "#f4f4f5",
  success: "#22c55e",
  successBg: "#f0fdf4",
  successBorder: "#bbf7d0",
  destructive: "#ef4444",
  destructiveBg: "#fef2f2",
  destructiveBorder: "#fecaca",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  amber: "#f59e0b",
  radius: "8px",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

/** Map hex color to a status label + icon + background set */
function getStatusStyle(color: string | undefined, success: boolean, badge?: string) {
  if (!success) {
    // Allow badge override for non-failure events like alerts/warnings
    if (badge) {
      switch (color) {
        case "#f59e0b": // amber
          return { label: badge, icon: "⚠", accent: tokens.amber, bg: "#fffbeb", border: "#fde68a" };
        case "#3b82f6": // blue
          return { label: badge, icon: "⚠", accent: tokens.blue, bg: "#eff6ff", border: "#bfdbfe" };
        case "#ef4444": // red
          return { label: badge, icon: "⚠", accent: tokens.destructive, bg: tokens.destructiveBg, border: tokens.destructiveBorder };
        default:
          return { label: badge, icon: "⚠", accent: tokens.amber, bg: "#fffbeb", border: "#fde68a" };
      }
    }
    return {
      label: "Failed",
      icon: "✕",
      accent: tokens.destructive,
      bg: tokens.destructiveBg,
      border: tokens.destructiveBorder,
    };
  }
  // Color-based variations for success-type events
  switch (color) {
    case "#3b82f6": // blue – informational (login, etc.)
      return { label: "Info", icon: "ℹ", accent: tokens.blue, bg: "#eff6ff", border: "#bfdbfe" };
    case "#8b5cf6": // purple – config backup
      return { label: "Completed", icon: "✓", accent: tokens.purple, bg: "#f5f3ff", border: "#ddd6fe" };
    case "#f59e0b": // amber – warning
      return { label: "Warning", icon: "⚠", accent: tokens.amber, bg: "#fffbeb", border: "#fde68a" };
    default: // green – success
      return {
        label: "Success",
        icon: "✓",
        accent: tokens.success,
        bg: tokens.successBg,
        border: tokens.successBorder,
      };
  }
}

export const SystemNotificationEmail: React.FC<SystemNotificationEmailProps> = ({
  title,
  message,
  fields,
  color,
  success,
  badge,
}) => {
  const status = getStatusStyle(color, success, badge);

  return (
    <div
      style={{
        fontFamily: tokens.fontFamily,
        lineHeight: "1.6",
        color: tokens.foreground,
        maxWidth: "560px",
        margin: "0 auto",
        padding: "24px 0",
      }}
    >
      {/* ── Outer card ──────────────────────────────────────── */}
      <table
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          borderCollapse: "collapse",
          backgroundColor: tokens.bg,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radius,
          overflow: "hidden",
        }}
      >
        <tbody>
          {/* ── Header ──────────────────────────────────────── */}
          <tr>
            <td style={{ padding: "24px 28px 0 28px" }}>
              <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "collapse" }}>
                <tbody>
                  <tr>
                    <td style={{ verticalAlign: "middle" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={LOGO_URL}
                        alt="DBackup"
                        width="24"
                        height="24"
                        style={{ borderRadius: "4px", verticalAlign: "middle" }}
                      />
                      <span
                        style={{
                          marginLeft: "10px",
                          fontSize: "14px",
                          fontWeight: 600,
                          color: tokens.foregroundMuted,
                          verticalAlign: "middle",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        DBackup
                      </span>
                    </td>
                    <td style={{ textAlign: "right" as const, verticalAlign: "middle" }}>
                      {/* Status badge */}
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: status.accent,
                          backgroundColor: status.bg,
                          border: `1px solid ${status.border}`,
                          borderRadius: "9999px",
                          letterSpacing: "0.01em",
                        }}
                      >
                        {status.icon}&nbsp;{status.label}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>

          {/* ── Divider ─────────────────────────────────────── */}
          <tr>
            <td style={{ padding: "16px 28px 0 28px" }}>
              <div style={{ height: "1px", backgroundColor: tokens.border }} />
            </td>
          </tr>

          {/* ── Title ───────────────────────────────────────── */}
          <tr>
            <td style={{ padding: "20px 28px 0 28px" }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: "18px",
                  fontWeight: 600,
                  color: tokens.foreground,
                  letterSpacing: "-0.025em",
                  lineHeight: "1.4",
                }}
              >
                {title}
              </h1>
            </td>
          </tr>

          {/* ── Message ─────────────────────────────────────── */}
          <tr>
            <td style={{ padding: "8px 28px 0 28px" }}>
              <p
                style={{
                  margin: 0,
                  fontSize: "14px",
                  color: tokens.foregroundMuted,
                  lineHeight: "1.6",
                }}
              >
                {message}
              </p>
            </td>
          </tr>

          {/* ── Fields table ────────────────────────────────── */}
          {fields && fields.length > 0 && (
            <tr>
              <td style={{ padding: "20px 28px 0 28px" }}>
                <table
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    borderCollapse: "collapse",
                    border: `1px solid ${tokens.border}`,
                    borderRadius: "6px",
                    overflow: "hidden",
                  }}
                >
                  <tbody>
                    {fields.map((field, idx) => (
                      <tr
                        key={idx}
                        style={{
                          borderBottom:
                            idx < fields.length - 1
                              ? `1px solid ${tokens.borderLight}`
                              : "none",
                        }}
                      >
                        <td
                          style={{
                            padding: "10px 14px",
                            fontWeight: 500,
                            fontSize: "12px",
                            color: tokens.foregroundMuted,
                            textTransform: "uppercase" as const,
                            letterSpacing: "0.05em",
                            width: "140px",
                            verticalAlign: "top",
                            backgroundColor: tokens.bgSubtle,
                            borderRight: `1px solid ${tokens.borderLight}`,
                          }}
                        >
                          {field.name}
                        </td>
                        <td
                          style={{
                            padding: "10px 14px",
                            fontSize: "13px",
                            fontWeight: 500,
                            color: tokens.foreground,
                            backgroundColor: tokens.bg,
                            wordBreak: "break-word" as const,
                          }}
                        >
                          {field.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </td>
            </tr>
          )}

          {/* ── Footer ──────────────────────────────────────── */}
          <tr>
            <td style={{ padding: "24px 28px 20px 28px" }}>
              <div style={{ height: "1px", backgroundColor: tokens.border, marginBottom: "16px" }} />
              <p
                style={{
                  margin: 0,
                  fontSize: "12px",
                  color: tokens.foregroundLight,
                  textAlign: "center" as const,
                  lineHeight: "1.5",
                }}
              >
                Sent by{" "}
                <a
                  href="https://dbackup.app"
                  style={{
                    color: tokens.foregroundMuted,
                    textDecoration: "none",
                    fontWeight: 500,
                  }}
                >
                  DBackup
                </a>
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
