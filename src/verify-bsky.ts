// Non-destructive Bluesky auth check: logs in and prints the resolved DID.
// Posts NOTHING. Lets us confirm BSKY_HANDLE / BSKY_APP_PASSWORD actually
// authenticate (the part dry-run can't exercise) without junk posts to the
// account. Run via the verify-bsky workflow (workflow_dispatch).

import { AtpAgent } from "@atproto/api";

async function main(): Promise<void> {
  const handle = process.env.BSKY_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD;
  if (!handle || !password) {
    throw new Error("BSKY_HANDLE and BSKY_APP_PASSWORD must be set");
  }
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle, password });
  const did = agent.session?.did;
  if (!did) throw new Error("login succeeded but session carries no DID");
  console.log(`verify-bsky: OK - authenticated as ${handle} (${did}), no post made`);
}

main().catch((err: unknown) => {
  // Never log the raw error object - SDK errors can include the request body
  // (and thus the app password). Message + status only.
  const msg = err instanceof Error ? err.message : String(err);
  const status =
    err && typeof err === "object" && "status" in err
      ? ` (status ${String((err as { status: unknown }).status)})`
      : "";
  console.error(`verify-bsky: FAILED - ${msg}${status}`);
  process.exit(1);
});
