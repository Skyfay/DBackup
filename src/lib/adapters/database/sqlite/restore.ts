import { DatabaseAdapter } from "@/lib/core/interfaces";

export const restore: DatabaseAdapter["restore"] = async (config, sourcePath, onLog, onProgress) => {
    throw new Error("Not implemented");
};

export const prepareRestore: DatabaseAdapter["prepareRestore"] = async (config, databases) => {
    // No-op for now
};
