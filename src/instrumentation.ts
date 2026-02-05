export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        console.log("Registering Application Instrumentation...");

        // Initialize demo mode (creates demo user if needed)
        try {
            const { initializeDemoMode } = await import('@/lib/demo-init');
            await initializeDemoMode();
        } catch (error) {
            console.error("Failed to initialize demo mode:", error);
        }

        // Initialize scheduler
        const { scheduler } = await import('@/lib/scheduler');
        await scheduler.init();
    }
}
