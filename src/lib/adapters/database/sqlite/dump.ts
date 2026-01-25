import { DatabaseAdapter } from "@/lib/core/interfaces";

export const dump: DatabaseAdapter["dump"] = async (config, destinationPath, onLog, onProgress) => {
    throw new Error("Not implemented");
};
