import { createClient } from "./server";

export async function createDatabaseClient() {
  return createClient();
}
