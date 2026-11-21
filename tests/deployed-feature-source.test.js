import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async path => readFile(new URL(path, import.meta.url), "utf8");
const [supportInbox, wheelInvoice, premiumRefund, wheelRefund] = await Promise.all([
  read("../supabase/functions/flamexbot-support-inbox/index.ts"),
  read("../supabase/functions/create-wheel-invoice/index.ts"),
  read("../supabase/functions/admin-premium-refund/index.ts"),
  read("../supabase/functions/admin-wheel-refund/index.ts"),
]);

test("admin support inbox source includes inbox text and attachment actions", () => {
  assert.match(supportInbox, /action === "inbox_list"/);
  assert.match(supportInbox, /action === "inbox_messages" \|\| action === "inbox_send"/);
  assert.match(supportInbox, /action === "send_media"/);
  assert.match(supportInbox, /action === "media"/);
  assert.match(supportInbox, /is_flamexbot_admin/);
});

test("wheel invoice uses the live configurable Stars price", () => {
  assert.match(wheelInvoice, /flamexbot_wheel_settings/);
  assert.match(wheelInvoice, /spin_price_stars/);
  assert.match(wheelInvoice, /priceStars/);
});

test("refund endpoints enforce founder identity and record refund state", () => {
  for (const source of [premiumRefund, wheelRefund]) {
    assert.match(source, /74a352c0-5a26-46a8-9b88-e71d0c3a9879/);
    assert.match(source, /refundStarPayment/);
    assert.match(source, /prepare_flamexbot_star_refund/);
    assert.match(source, /complete_flamexbot_star_refund/);
  }
});
