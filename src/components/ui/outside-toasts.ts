/**
 * A dialog or a side panel that is open blocks every click outside of it, the toasts included, and
 * takes a click outside as the wish to close. A toast that shows over it, like Back up now in the
 * panel of a server with its Open the run, must still work. The toasts take clicks themselves, see
 * `ui/sonner.tsx`, and this keeps a click on one from closing the dialog behind it.
 */

const TOASTER = "[data-sonner-toaster]";

/** Whether an event of Radix outside a dialog happened on a toast. */
export function onToast(event: { target: EventTarget | null }): boolean {
    return event.target instanceof Element && event.target.closest(TOASTER) !== null;
}

/** An `onInteractOutside` that leaves a click on a toast alone and hands every other one on. */
export function ignoringToasts<E extends { target: EventTarget | null; preventDefault(): void }>(handler?: (event: E) => void) {
    return (event: E) => {
        if (onToast(event)) {
            event.preventDefault();
            return;
        }
        handler?.(event);
    };
}
