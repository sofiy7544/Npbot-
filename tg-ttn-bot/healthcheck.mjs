/**
 * Container healthcheck.
 *
 * The bot is long-polling, so when no PORT is set (docker-compose, local) there
 * is nothing to probe and "the process is running" is all we can assert — the
 * container runtime already restarts it if it exits.
 *
 * When PORT is set, the health server is up and we ask it about Postgres+Redis.
 */
const port = process.env.PORT;
if (!port) process.exit(0);

const res = await fetch(`http://127.0.0.1:${port}/health`, {
  signal: AbortSignal.timeout(4000),
}).catch((e) => {
  console.error(`healthcheck: ${e.message}`);
  return null;
});

if (!res || !res.ok) {
  console.error(`healthcheck: status ${res ? res.status : "no response"}`);
  process.exit(1);
}
process.exit(0);
