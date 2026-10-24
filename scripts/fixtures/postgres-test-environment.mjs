import pg from "pg";

// Opt in through TEST_DATABASE_URL. Each live test owns an isolated schema,
// so it can run in CI without production saves or fixtures from data/.
export async function preparePostgresTestEnvironment(label) {
  const connectionString = String(process.env.TEST_DATABASE_URL || "").trim();
  if (!connectionString) return { env: {}, cleanup: async () => {} };
  const schema = `jade_${label}_${process.pid}_${Date.now()}`;
  const admin = new pg.Pool({ connectionString, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return {
    env: { JADE_WORLD_PERSIST: "1", JADE_WORLD_PERSIST_DRIVER: "postgres",
      JADE_ALLOW_VOLATILE_PRODUCTION: "0", DATABASE_URL: url.toString() },
    async cleanup() {
      try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { await admin.end(); }
    }
  };
}
