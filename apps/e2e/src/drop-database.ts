import { MongoClient } from "mongodb";

import { mongoUrl } from "./env.ts";

// Runs before Playwright starts the servers, so they find an empty database and create their indexes on it
const client = new MongoClient(mongoUrl);
try {
  await client.db().dropDatabase();
} finally {
  await client.close();
}
