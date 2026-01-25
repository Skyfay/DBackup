import { DatabaseAdapter } from "@/lib/core/interfaces";

export const test: DatabaseAdapter["test"] = async (config) => {
    return { success: false, message: "Not implemented" };
};

export const getDatabases: DatabaseAdapter["getDatabases"] = async (config) => {
     // For SQLite, the path itself is the database. We can return the filename.
     const path = config.path as string;
     const name = path.split(/[\\/]/).pop() || "database.sqlite";
     return [name];
};
