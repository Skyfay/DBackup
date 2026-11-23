export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        console.log("Registering Application Instrumentation...");

        // Recovery, the scheduler and the checks at start act for every tenant. Imported inside
        // the check of the runtime, which the Edge build leaves out with everything it imports.
        const { runAsSystem } = await import('@/lib/tenant/context');
        const { startServer } = await import('@/lib/server/startup');
        await runAsSystem(startServer);
    }
}
