import { z } from "zod";

export interface AdapterConfigSchema {
    name: string;
    label: string;
    description?: string;
    input: z.ZodObject<any>;
}

export interface BackupMetadata {
    version: 1;
    jobId: string;
    jobName: string;
    sourceName: string;
    sourceType: string;
    databases: string[] | { count: number; names?: string[] };
    timestamp: string;
    originalFileName: string;
    sourceId: string;
}

export interface BaseAdapter {
    id: string; // Unique identifier (e.g., 'mysql', 's3')
    name: string; // Display name
    configSchema: z.ZodObject<any>; // Schema for configuration
    /**
     * Optional method to test the connection configuration
     */
    test?: (config: any) => Promise<{ success: boolean; message: string }>;

    /**
     * Optional method to list available databases (for Source adapters)
     */
    getDatabases?: (config: any) => Promise<string[]>;
}

export type BackupResult = {
    success: boolean;
    path?: string;
    size?: number;
    error?: string;
    logs: string[];
    metadata?: any;
    startedAt: Date;
    completedAt: Date;
};

export interface DatabaseAdapter extends BaseAdapter {
    type: 'database';
    /**
     * Dumps the database to a local file path
     * @param config The user configuration for this adapter
     * @param destinationPath The path where the dump should be saved locally
     */
    dump(config: any, destinationPath: string): Promise<BackupResult>;

    /**
     * Restores the database from a local file path
     * @param config The user configuration for this adapter
     * @param sourcePath The path to the dump file
     */
    restore(config: any, sourcePath: string): Promise<BackupResult>;

    /**
     * Optional method to analyze a dump file and return contained databases
     */
    analyzeDump?: (sourcePath: string) => Promise<string[]>;
}

export type FileInfo = {
    name: string;
    path: string;
    size: number;
    lastModified: Date;
};

export interface StorageAdapter extends BaseAdapter {
    type: 'storage';
    /**
     * Uploads a local file to the storage destination
     */
    upload(config: any, localPath: string, remotePath: string): Promise<boolean>;

    /**
     * Downloads a file from storage to local path
     */
    download(config: any, remotePath: string, localPath: string): Promise<boolean>;

    /**
     * Reads the content of a file as a string
     */
    read?(config: any, remotePath: string): Promise<string | null>;

    /**
     * Lists files in a directory
     */
    list(config: any, remotePath: string): Promise<FileInfo[]>;

    /**
     * Deletes a file
     */
    delete(config: any, remotePath: string): Promise<boolean>;
}

export interface NotificationAdapter extends BaseAdapter {
    type: 'notification';
    send(config: any, message: string, context?: any): Promise<boolean>;
}
