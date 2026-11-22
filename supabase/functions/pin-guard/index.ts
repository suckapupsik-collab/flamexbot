import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Server-side PIN guard for the Mini App lock. The PIN hash never leaves the server.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PBKDF2_ITERATIONS = 150000;
const FREE_ATTEMPTS = 5;          // wrong tries before the first lockout
const MAX_LOCK_SECONDS = 300;     // lockout never longer than 5 minutes
const PIN_PATTERN = /^\d{4,8}$/;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers });
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

async function pinHash(pin: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return b64(new Uint8Array(bits));
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/** Lockout schedule: after every 5 wrong tries the wait doubles, capped at MAX_LOCK_SECONDS. Pure, so it can be tested. */
export function lockSecondsAfter(fails: number) {
  if (fails < FREE_ATTEMPTS || fails % FREE_ATTEMPTS !== 0) return 0;
  return Math.min(MAX_LOCK_SECONDS, 15 * 2 ** (fails / FREE_ATTEMPTS - 1));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) return json({ error: "PIN service is not configured" }, 503);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);
  const userId = authData.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profile, error: profileError } = await admin.from("profiles").select("is_banned").eq("id", userId).maybeSingle();
  if (profileError) return json({ error: "Could not check account" }, 500);
  if (!profile) return json({ error: "Account profile not found" }, 401);
  if (profile.is_banned) return json({ error: "Account is blocked" }, 403);

  let body: { action?: string; pin?: string; currentPin?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = body.action;

  const { data: row, error: rowError } = await admin.from("flamexbot_user_pins")
    .select("salt,hash,fails,locked_until").eq("profile_id", userId).maybeSingle();
  if (rowError) return json({ error: "Could not read PIN" }, 500);

  if (action === "status") {
    return json({ enabled: Boolean(row), locked_until: row?.locked_until ?? null });
  }

  // Every check that touches a PIN goes through the same lockout gate.
  const lockedUntil = row?.locked_until ? new Date(row.locked_until).getTime() : 0;
  if (lockedUntil > Date.now()) {
    return json({ ok: false, reason: "locked", locked_until: row!.locked_until }, 429);
  }

  async function verify(pin: string) {
    if (!row) return false;
    const ok = constantTimeEqual(await pinHash(pin, fromB64(row.salt)), row.hash);
    const fails = ok ? 0 : (row.fails ?? 0) + 1;
    const lockSeconds = ok ? 0 : lockSecondsAfter(fails);
    const { error: attemptUpdateError } = await admin.from("flamexbot_user_pins").update({
      fails,
      locked_until: lockSeconds ? new Date(Date.now() + lockSeconds * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("profile_id", userId);
    // Fail closed: never accept/reject a PIN if its attempt could not be recorded.
    if (attemptUpdateError) throw new Error("Could not record PIN attempt");
    return ok;
  }

  if (action === "verify") {
    if (!PIN_PATTERN.test(String(body.pin ?? ""))) return json({ error: "Invalid PIN" }, 400);
    try {
      const ok = await verify(String(body.pin));
      return json({ ok }, ok ? 200 : 401);
    } catch {
      return json({ error: "Could not record PIN attempt" }, 503);
    }
  }

  if (action === "set") {
    const pin = String(body.pin ?? "");
    if (!PIN_PATTERN.test(pin)) return json({ error: "PIN must be 4 to 8 digits" }, 400);
    if (row) {
      // Changing or replacing an existing PIN needs the current one.
      if (!PIN_PATTERN.test(String(body.currentPin ?? ""))) {
        return json({ ok: false, error: "Current PIN is wrong" }, 401);
      }
      try {
        if (!(await verify(String(body.currentPin)))) return json({ ok: false, error: "Current PIN is wrong" }, 401);
      } catch {
        return json({ error: "Could not record PIN attempt" }, 503);
      }
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const { error } = await admin.from("flamexbot_user_pins").upsert({
      profile_id: userId, salt: b64(salt), hash: await pinHash(pin, salt), fails: 0, locked_until: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id" });
    if (error) return json({ error: "Could not save PIN" }, 500);
    return json({ ok: true, enabled: true });
  }

  if (action === "remove") {
    if (row) {
      if (!PIN_PATTERN.test(String(body.pin ?? ""))) return json({ ok: false, error: "Current PIN is wrong" }, 401);
      try {
        if (!(await verify(String(body.pin)))) return json({ ok: false, error: "Current PIN is wrong" }, 401);
      } catch {
        return json({ error: "Could not record PIN attempt" }, 503);
      }
    }
    const { error } = await admin.from("flamexbot_user_pins").delete().eq("profile_id", userId);
    if (error) return json({ error: "Could not remove PIN" }, 500);
    return json({ ok: true, enabled: false });
  }

  return json({ error: "Unknown action" }, 400);
});
