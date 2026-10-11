// Runs in every test worker before a test file loads, so Prisma and the encryption of the app
// open the database of the tests and never the dev database.
import { testEnvironment } from "./environment";

Object.assign(process.env, testEnvironment());
