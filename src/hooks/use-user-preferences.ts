"use client"

import { useState, useEffect } from "react";

interface UserPreferences {
    autoRedirectOnJobStart: boolean;
}

const defaultPreferences: UserPreferences = {
    autoRedirectOnJobStart: true,
};

export function useUserPreferences(): UserPreferences {
    const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);

    useEffect(() => {
        const fetchPreferences = async () => {
            try {
                const res = await fetch("/api/user/preferences");
                if (res.ok) {
                    const data = await res.json();
                    setPreferences({
                        autoRedirectOnJobStart: data.autoRedirectOnJobStart ?? true,
                    });
                }
            } catch {
                // Use defaults on error
            }
        };

        fetchPreferences();
    }, []);

    return preferences;
}
