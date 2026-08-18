import { execFileSync } from "node:child_process";

const project = process.env.BARSIKCHAT_DEV_PROJECT ?? "barsikchat-dev";
const compose = ["compose", "-p", project, "-f", "compose.dev.yml"];
const restoreDb = "barsikchat_restore_check";

function docker(args, options = {}) {
  return execFileSync("docker", [...compose, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit"
  });
}

const latest = docker([
  "exec", "-T", "postgres", "sh", "-ec", "ls -t /backups/db-*.dump | head -n 1"
], { capture: true }).trim();

if (!latest) throw new Error("No development backup found");

docker(["exec", "-T", "postgres", "dropdb", "--if-exists", "-U", "chatosnova", restoreDb]);
try {
  docker(["exec", "-T", "postgres", "createdb", "-U", "chatosnova", restoreDb]);
  docker(["exec", "-T", "postgres", "pg_restore", "-U", "chatosnova", "-d", restoreDb, latest]);
  docker([
    "exec", "-T", "postgres", "psql", "-U", "chatosnova", "-d", restoreDb,
    "-v", "ON_ERROR_STOP=1", "-c", "SELECT count(*) AS migrations FROM schema_migrations;"
  ]);
  console.log("Development backup restored successfully");
} finally {
  docker(["exec", "-T", "postgres", "dropdb", "--if-exists", "-U", "chatosnova", restoreDb]);
}
