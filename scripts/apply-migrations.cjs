const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");
const fallbackConnectionFile = path.join(root, "supabase-connection.txt");

function getConnectionString() {
  if (process.env.SUPABASE_DB_URL) {
    return process.env.SUPABASE_DB_URL;
  }

  if (fs.existsSync(fallbackConnectionFile)) {
    return fs.readFileSync(fallbackConnectionFile, "utf8").trim();
  }

  throw new Error("Set SUPABASE_DB_URL or create supabase-connection.txt.");
}

async function main() {
  const connectionString = getConnectionString();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migrations found.");
    return;
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      console.log(`Applied ${file}`);
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
