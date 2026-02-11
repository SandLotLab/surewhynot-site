 * - MAIL_FROM (var)
 * - PUBLIC_BASE_URL (var)      e.g. "https://surewhynot.app"
 * - FAX_PAGE_PATH (var)        e.g. "/pages/fax.html"
 *
 * PRICING vars:
 * - VERIFY_TTL_SECONDS (var)   default 1800
 * - FREE_PAGES_PER_DAY (var)   default 5
 * - PRICE_PER_PAGE_CENTS (var) default 10
 *
 * SINCH:
 * - SINCH_PROJECT_ID (var)
 * - SINCH_ACCESS_KEY (secret)
 * - SINCH_ACCESS_SECRET (secret)
 *
 * STRIPE:
 * - STRIPE_SECRET_KEY (secret)
 * - STRIPE_WEBHOOK_SECRET (secret)
 */



export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // Debug helper to confirm which Stripe key family is active in this deployed worker.
    if (url.pathname === "/api/_debug/stripe" && req.method === "GET") {
      const key = String(env.STRIPE_SECRET_KEY || "").trim();
      return json(
        {
          configured: !!key,
          prefix: key ? key.slice(0, 3) : null,
          startsWithSk: key ? key.startsWith("sk_") : false,
          length: key.length,
        },
        200
      );
    }

    // FAX
    if (url.pathname === "/api/fax/draft" && req.method === "POST") return draftFax(req, env);
    if (url.pathname === "/api/fax/verify/start" && req.method === "POST") return startVerify(req, env);
    if (url.pathname === "/api/fax/verify/confirm" && req.method === "GET") return confirmVerify(url, env);
    if (url.pathname === "/api/fax/status" && req.method === "GET") return faxStatus(url, env);
    if (url.pathname === "/api/fax/content" && req.method === "GET") return faxContent(url, env);
    if (url.pathname === "/api/fax/price" && req.method === "GET") return faxPrice(url, env);
    if (url.pathname === "/api/fax/send" && req.method === "POST") return sendFax(req, env);
   // STRIPE
if (url.pathname === "/api/fax/pay/create" && req.method === "POST") return createCheckout(req, env);
if (url.pathname === "/api/stripe/webhook" && req.method === "POST") return stripeWebhook(req, env);

    return new Response("Not found", { status: 404 });
  },
};

// ----------------- COMMON -----------------

const KV_PREFIX = "fax:";
const KV_VERIFY_PREFIX = "faxv:";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
@@ -143,51 +157,63 @@ async function createCheckout(req, env) {

  // tie payment to this fax
  fd.set("client_reference_id", submission_id);
  fd.set("metadata[submission_id]", submission_id);
  fd.set("metadata[email]", String(draft.verifiedEmail || ""));

  // One line item: per page
   const PRICE = cfgInt(env, "PRICE_PER_PAGE_CENTS", 10);

   fd.set("line_items[0][quantity]", String(pricing.paidPages));
   fd.set("line_items[0][price_data][currency]", "usd");
   fd.set("line_items[0][price_data][unit_amount]", String(PRICE));
   fd.set("line_items[0][price_data][product_data][name]", "Fax page(s) over free limit");


  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Bearer ${stripeSecretKey}`,
    },
    body: fd.toString(),
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.url || !j?.id) {
    return json(
      {
        error: "Stripe create session failed.",
        stripe: j,
        stripeKeyInfo: {
          prefix: stripeSecretKey.slice(0, 3),
          length: stripeSecretKey.length,
        },
      },
      502
    );
  }

  draft.stripeSessionId = j.id;
  draft.stripeCheckoutUrl = j.url;
  draft.lastStatus = "checkout_created";
  await env.FAX_KV.put(KV_PREFIX + submission_id, JSON.stringify(draft), { expirationTtl: 3600 });

  return json({ url: j.url, id: j.id, pricing }, 200);
}

async function stripeWebhook(req, env) {
  // Minimal: accept Stripe webhook and mark draft as paid on checkout.session.completed.
  // NOTE: This version does NOT verify signature (works for testing).
  const event = await req.json().catch(() => null);
  if (!event?.type) return bad(400, "Bad webhook.");

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    const submission_id = session?.metadata?.submission_id || session?.client_reference_id;
    if (submission_id) {
      const draftRaw = await env.FAX_KV.get(KV_PREFIX + submission_id);
      if (draftRaw) {
        const draft = JSON.parse(draftRaw);
        draft.paid = true;
        draft.paidAt = Date.now();
        draft.lastStatus = "paid";