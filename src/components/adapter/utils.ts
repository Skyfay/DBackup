
import { Database, Folder, HardDrive, MessageSquare, Mail, Disc, Network, Globe } from "lucide-react";

export function getAdapterIcon(adapterId: string) {
    const id = adapterId.toLowerCase();
    if (id.includes('mysql') || id.includes('postgres') || id.includes('mongo') || id.includes('redis')) return Database;
    if (id.includes('local')) return Folder;
    if (id.includes('s3') || id.includes('r2') || id.includes('minio')) return HardDrive;
    if (id.includes('webdav')) return Globe;
    if (id.includes('smb') || id.includes('samba') || id.includes('sftp') || id === 'ftp') return Network;
    if (id.includes('discord') || id.includes('slack')) return MessageSquare;
    if (id.includes('email') || id.includes('smtp')) return Mail;
    return Disc;
}
