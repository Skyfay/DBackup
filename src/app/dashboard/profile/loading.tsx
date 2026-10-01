import { SettingsSkeleton } from "@/components/dashboard/settings/settings-skeleton";

/** The profile while it loads, in the frame of Settings it is built in. */
export default function ProfileLoading() {
    return <SettingsSkeleton label="Loading your profile" />;
}
