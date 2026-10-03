import * as React from "react";

// Matches Tailwind's `md` breakpoint, where the sidebar switches between the fixed rail and the slide-in sheet.
const MOBILE_BREAKPOINT = 768;

/**
 * Undefined until the first render in the browser has measured the window. A layout that
 * differs between phone and desktop can wait for it instead of flashing the wrong one.
 */
export function useIsMobileState(): boolean | undefined {
    const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

    React.useEffect(() => {
        const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
        const onChange = () => {
            setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
        };
        mql.addEventListener("change", onChange);
        setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
        return () => mql.removeEventListener("change", onChange);
    }, []);

    return isMobile;
}

export function useIsMobile() {
    return !!useIsMobileState();
}
