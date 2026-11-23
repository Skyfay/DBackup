import { headers } from "next/headers";

/**
 * The headers of the request being handled. This is the one place outside `src/app` that asks the
 * framework for the request, so `src/lib` and `src/services` stay free of Next.js and a server that
 * replaces it only has to answer here. Outside a request, like in a scheduled task, it throws.
 */
export async function requestHeaders(): Promise<Headers> {
    return headers();
}
