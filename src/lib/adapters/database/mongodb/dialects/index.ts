import { DatabaseDialect } from "../../common/dialect";
import { MongoDBBaseDialect } from "./mongodb-base";

export function getDialect(adapterId: string, version?: string): DatabaseDialect {
    return new MongoDBBaseDialect();
}
