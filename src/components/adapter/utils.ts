
import { Database, Folder, HardDrive, MessageSquare, Mail, Disc } from "lucide-react";

export function getAdapterIcon(adapterId: string) {
    const id = adapterId.toLowerCase();
    if (id.includes('mysql') || id.includes('postgres') || id.includes('mongo') || id.includes('redis')) return Database;
    if (id.includes('local')) return Folder;
    if (id.includes('s3') || id.includes('r2') || id.includes('minio')) return HardDrive;
    if (id.includes('discord') || id.includes('slack')) return MessageSquare;
    if (id.includes('email') || id.includes('smtp')) return Mail;
    return Disc;
}
