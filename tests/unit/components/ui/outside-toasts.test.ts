/**
 * A toast that shows over an open dialog or side panel, like Open the run after Back up now in the
 * panel of a server, takes its click without closing what lies behind it.
 */
import { describe, expect, it, vi } from "vitest";
import { ignoringToasts, onToast } from "@/components/ui/outside-toasts";

function outsideEvent(target: Element) {
    return { target, preventDefault: vi.fn() };
}

describe("a click outside of a dialog", () => {
    it("on a toast leaves the dialog open and never reaches its own handler", () => {
        const toaster = document.createElement("section");
        toaster.setAttribute("data-sonner-toaster", "");
        const button = document.createElement("button");
        toaster.appendChild(button);
        document.body.appendChild(toaster);

        const handler = vi.fn();
        const event = outsideEvent(button);
        ignoringToasts(handler)(event);

        expect(onToast(event)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
        toaster.remove();
    });

    it("anywhere else goes on to the handler of the dialog, which closes it as before", () => {
        const page = document.createElement("div");
        document.body.appendChild(page);

        const handler = vi.fn();
        const event = outsideEvent(page);
        ignoringToasts(handler)(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(handler).toHaveBeenCalledWith(event);
        page.remove();
    });
});
