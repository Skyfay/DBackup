import type * as React from "react";

/**
 * True for a click on a row or card itself. Not on a control inside it, not inside a popover
 * it opened (React bubbles those through the row although they render elsewhere), and not
 * the end of a text selection.
 */
export function isPlainClick(event: React.MouseEvent<HTMLElement>): boolean {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target)) return false;
    if (target.closest("button, a, input, select, textarea, label, [role=checkbox], [role=menuitem]")) return false;
    return !window.getSelection()?.toString();
}
