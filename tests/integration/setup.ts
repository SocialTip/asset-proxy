export const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:8080";

beforeAll(async () => {
  try {
    const res = await fetch(`${SERVICE_URL}/health`);
    if (res.ok) return;
  } catch {
    // not reachable
  }
  throw new Error(
    `Service at ${SERVICE_URL} is not running. Run \`yarn test:up\` to start it via Docker Compose.`,
  );
});
