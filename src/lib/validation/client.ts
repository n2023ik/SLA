/**
 * Test-only Supabase clients.
 *
 * - `anonClient()`  — publishable key, no session. Must be denied everywhere.
 * - `authedClient()` — a real signed-in operator session. Row-level security
 *   applies as that user, exactly like a dashboard request.
 * - `adminClient()` — service role, used ONLY to provision and clean up test
 *   fixtures. Never imported by application code, so the key never reaches the
 *   browser bundle.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverClient } from "../ops.data";

const url = () => process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;

export const TEST_OPERATOR_EMAIL = "validation.operator@sla-guardian.test";
const TEST_OPERATOR_PASSWORD = "sla-guardian-validation-2f8c41";

/** Marker on every intervention row a test creates, so cleanup is exact. */
export const TEST_SIGNATURE = "VALIDATION_SUITE";

export const anonClient = (): SupabaseClient => serverClient();

export function adminClient(): SupabaseClient {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to run the validation suite");
  return createClient(url(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let session: Promise<{ client: SupabaseClient; userId: string }> | null = null;

/** Signs in (creating the fixture operator on first run) and caches the session. */
export function authedClient(): Promise<{ client: SupabaseClient; userId: string }> {
  session ??= (async () => {
    const admin = adminClient();
    // Idempotent: the fixture operator survives between runs.
    await admin.auth.admin.createUser({
      email: TEST_OPERATOR_EMAIL,
      password: TEST_OPERATOR_PASSWORD,
      email_confirm: true,
    });

    const client = anonClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: TEST_OPERATOR_EMAIL,
      password: TEST_OPERATOR_PASSWORD,
    });
    if (error || !data.user) {
      throw new Error(`Could not sign in the validation operator: ${error?.message ?? "no user"}`);
    }
    return { client, userId: data.user.id };
  })();
  return session;
}

/** Removes every intervention (and its revisions) created by the suite. */
export async function cleanupTestInterventions(): Promise<void> {
  const admin = adminClient();
  const { data } = await admin.from("interventions").select("id").eq("signature", TEST_SIGNATURE);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return;
  await admin.from("intervention_revisions").delete().in("intervention_id", ids);
  await admin.from("interventions").delete().in("id", ids);
}
