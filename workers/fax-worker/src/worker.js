import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * REQUIRED bindings:
 * - FAX_KV (KV)
 * - FAX_R2 (R2 bucket)
 * - USAGE_DO (Durable Object binding)
 * - MAILCHANNELS_API_KEY (secret)
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

    if (url.pathname === "/api/_debug/stripe") {
      const k = env.STRIPE_SECRET_KEY || "";
      return json({ prefix: k.slice(0, 3), len: k.length }, 200);
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
  });
}
function bad(status, msg) {
  return json({ error: msg }, status);
}
function ttlSeconds(env) {
  const n = parseInt(env.VERIFY_TTL_SECONDS || "1800", 10);
  return Number.isFinite(n) && n > 0 ? n : 1800;
}

// ----------------- STATUS -----------------

async function faxStatus(url, env) {
  const submission_id = (url.searchParams.get("submission_id") || "").trim();
  if (!submission_id) return bad(400, "Missing submission_id.");

  const draftRaw = await env.FAX_KV.get(KV_PREFIX + submission_id);
  if (!draftRaw) return bad(404, "Draft not found.");

  const d = JSON.parse(draftRaw);

  return json(
    {
      submission_id: d.submission_id,
      pages: d.pages,
      verified: !!d.verified,
      verifiedEmail: d.verifiedEmail,
      sent: !!d.sent,
      lastStatus: d.lastStatus,
      sinchFaxId: d.sinchFaxId || null,
      paid: !!d.paid,
      stripeCheckoutUrl: d.stripeCheckoutUrl || null,
      stripeSessionId: d.stripeSessionId || null,
    },
    200
  );
}

async function createCheckout(req, env) {
  const body = await req.json().catch(() => null);
  const submission_id = String(body?.submission_id || "").trim();
  if (!submission_id) return bad(400, "Missing submission_id.");

  const draftRaw = await env.FAX_KV.get(KV_PREFIX + submission_id);
  if (!draftRaw) return bad(404, "Draft not found.");
  const draft = JSON.parse(draftRaw);

  if (!draft.verified) return bad(403, "Email not verified.");
  if (draft.sent) return bad(409, "Already sent.");

  const pricing = await computePrice(env, draft);
  if (pricing.dueCents <= 0) {
    // nothing to pay
    draft.paid = true;
    draft.paidAt = Date.now();
    draft.lastStatus = "paid_free";
    await env.FAX_KV.put(KV_PREFIX + submission_id, JSON.stringify(draft), { expirationTtl: 3600 });
    return json({ paid: true, free: true }, 200);
  }

  // Create Stripe Checkout Session
  const successUrl = new URL(env.FAX_PAGE_PATH, env.PUBLIC_BASE_URL);
  successUrl.searchParams.set("submission_id", submission_id);
  successUrl.searchParams.set("paid", "1");

  const cancelUrl = new URL(env.FAX_PAGE_PATH, env.PUBLIC_BASE_URL);
  cancelUrl.searchParams.set("submission_id", submission_id);
  cancelUrl.searchParams.set("canceled", "1");

  const fd = new URLSearchParams();
  fd.set("mode", "payment");
  fd.set("automatic_payment_methods[enabled]", "true");
  fd.set("success_url", successUrl.toString());
  fd.set("cancel_url", cancelUrl.toString());

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
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
    body: fd.toString(),
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.url || !j?.id) return json({ error: "Stripe create session failed.", stripe: j }, 502);

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
        await env.FAX_KV.put(KV_PREFIX + submission_id, JSON.stringify(draft), { expirationTtl: 3600 });
      }
    }
  }

  return new Response("ok", { status: 200 });
}

// ----------------- CONTENT URL (Sinch fetches this) -----------------

async function faxContent(url, env) {
  const submission_id = (url.searchParams.get("submission_id") || "").trim();
  const token = (url.searchParams.get("token") || "").trim();
  if (!submission_id || !token) return new Response("Missing", { status: 400 });

  const draftRaw = await env.FAX_KV.get(KV_PREFIX + submission_id);
  if (!draftRaw) return new Response("Not found", { status: 404 });

  const draft = JSON.parse(draftRaw);
  if (draft.contentToken !== token) return new Response("Forbidden", { status: 403 });

  const obj = await env.FAX_R2.get(draft.r2Key);
  if (!obj) return new Response("Missing file", { status: 404 });

  return new Response(await obj.arrayBuffer(), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}

// ----------------- DRAFT (UPLOAD + CONVERT TO PDF) -----------------

async function draftFax(req, env) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) return bad(400, "Expected multipart/form-data.");

  const form = await req.formData();
  const to = (form.get("to") || "").toString().trim();
  const from = env.DEFAULT_FROM_FAX;
  const message = (form.get("message") || "").toString();

  // accept either "file" or "pdf"
  const file = form.get("file") || form.get("pdf");

  if (!to) return bad(400, "Missing fax number.");
  if (!file || typeof file === "string") return bad(400, "Missing file.");

  const ab = await file.arrayBuffer();
  const mime = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();

  let pdfBytes;
  let pages = 0;

  try {
    // PDF stays PDF
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      const doc = await PDFDocument.load(ab);
      pages = doc.getPageCount();
      pdfBytes = ab;
    }
    // PNG -> PDF
    else if (mime === "image/png" || name.endsWith(".png")) {
      const doc = await PDFDocument.create();
      const img = await doc.embedPng(ab);
      const { width, height } = img.size();
      const page = doc.addPage([width, height]);
      page.drawImage(img, { x: 0, y: 0, width, height });
      pages = doc.getPageCount();
      pdfBytes = await doc.save();
    }
    // JPG/JPEG -> PDF
    else if (mime === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
      const doc = await PDFDocument.create();
      const img = await doc.embedJpg(ab);
      const { width, height } = img.size();
      const page = doc.addPage([width, height]);
      page.drawImage(img, { x: 0, y: 0, width, height });
      pages = doc.getPageCount();
      pdfBytes = await doc.save();
    }
    // TXT -> PDF
    else if (mime === "text/plain" || name.endsWith(".txt")) {
      const text = new TextDecoder("utf-8").decode(new Uint8Array(ab));

      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);

      let page = doc.addPage([612, 792]); // letter
      const fontSize = 11;
      const left = 40;
      let y = 792 - 50;

      const lines = text.replace(/\r\n/g, "\n").split("\n");
      for (const line of lines) {
        const chunks = line.match(/.{1,90}/g) || [""];
        for (const chunk of chunks) {
          page.drawText(chunk, { x: left, y, size: fontSize, font });
          y -= 14;
          if (y < 50) {
            page = doc.addPage([612, 792]);
            y = 792 - 50;
          }
        }
      }

      pages = doc.getPageCount();
      pdfBytes = await doc.save();
    } else {
      return bad(415, "Unsupported file type. Use PDF, PNG, JPG/JPEG, or TXT.");
    }
  } catch {
    return bad(400, "Could not process file.");
  }

  const submission_id = crypto.randomUUID();
  const r2Key = `fax/${submission_id}.pdf`;

  // tokenized URL so Sinch can fetch the PDF
  const contentToken = crypto.randomUUID().replaceAll("-", "");
  const contentUrl = new URL("/api/fax/content", env.PUBLIC_BASE_URL);
  contentUrl.searchParams.set("submission_id", submission_id);
  contentUrl.searchParams.set("token", contentToken);

  await env.FAX_R2.put(r2Key, pdfBytes, {
    httpMetadata: { contentType: "application/pdf" },
  });

  const draft = {
    submission_id,
    to,
    from,
    message,
    r2Key,
    pages,
    contentToken,
    contentUrl: contentUrl.toString(),

    createdAt: Date.now(),
    verified: false,
    verifiedEmail: null,
    verifiedAt: null,

    paid: false,
    paidAt: null,

    stripeSessionId: null,
    stripeCheckoutUrl: null,

    sent: false,
    sinchFaxId: null,
    lastStatus: "drafted",
  };

  await env.FAX_KV.put(KV_PREFIX + submission_id, JSON.stringify(draft), { expirationTtl: 3600 });
  return json({ submission_id }, 200);
}

// ----------------- VERIFY EMAIL -----------------

async function startVerify(req, env) {
  const body = await req.json().catch(() => null);
  const submission_id = String(body?.submission_id || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();

  if (!submission_id) return bad(400, "Missing submission_id.");
  if (!email) return bad(400, "Missing email.");

  const raw = await env.FAX_KV.get(KV_PREFIX + submission_id);
  if (!raw) return bad(404, "Draft not found.");

  const token = crypto.randomUUID().replaceAll("-", "");
  const ttl = ttlSeconds(env);

  await env.FAX_KV.put(
    KV_VERIFY_PREFIX + token,
    JSON.stringify({ submission_id, email, createdAt: Date.now() }),
    { expirationTtl: ttl }
  );

  const confirmUrl = new URL("/api/fax/verify/confirm", env.PUBLIC_BASE_URL);
  confirmUrl.searchParams.set("token", token);

  const subject = "Verify your email to send your fax";
  const text = `Click to verify:\n${confirmUrl.toString()}\n\nThis link expires in ${Math.floor(ttl / 60)} minutes.`;

  const ok = await sendMailchannels(env, { to: email, subject, text });
  if (!ok) return bad(500, "Email send failed.");

  return json({ ok: true }, 200);
}

async function confirmVerify(url, env) {
  const token = url.searchParams.get("token") || "";
  if (!token) return new Response("Missing token", { status: 400 });

  const raw = await env.FAX_KV.get(KV_VERIFY_PREFIX + token);
  if (!raw) return new Response("Expired or invalid token", { status: 400 });

  const v = JSON.parse(raw);
  const submission_id = v.submission_id;
  const email = v.email;

  const draftRaw = await env.FAX_KV.get(KV_PREFIX + submission_id);
  if (!draftRaw) return new Response("Draft not found", { status: 404 });

  const draft = JSON.parse(draftRaw);
  draft.verified = true;
  draft.verifiedEmail = email;
  draft.verifiedAt = Date.now();
  draft.lastStatus = "verified";

  await env.FAX_KV.put(KV_PREFIX + submission_id, JSON.stringify(draft), { expirationTtl: 3600 });
  await env.FAX_KV.delete(KV_VERIFY_PREFIX + token);

  const back = new URL(env.FAX_PAGE_PATH, env.PUBLIC_BASE_URL);
  back.searchParams.set("submission_id", submission_id);
  return Response.redirect(back.toString(), 302);
}

async function sendMailchannels(env, { to, subject, text }) {
  const from = env.MAIL_FROM;

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from },
    subject,
    content: [{ type: "text/plain", value: text }],
  };

  const r = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.MAILCHANNELS_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  return r.ok;
}

// ----------------- PRICING + USAGE -----------------

function laDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function cfgInt(env, key, fallback) {
  const v = parseInt(env[key] || "", 10);
  return Number.isFinite(v) ? v : fallback;
}
function usageStub(env, email) {
  const id = env.USAGE_DO.idFromName(`${email}|${laDateKey()}`);
  return env.USAGE_DO.get(id);
}
async function getUsedPages(env, email) {
  const r = await usageStub(env, email).fetch("https://do/used");
  return (await r.json()).used || 0;
}
async function addUsedPages(env, email, pages) {
  await usageStub(env, email).fetch("https://do/add", {
    method: "POST",
    body: JSON.stringify({ pages }),
  });
}
async function computePrice(env, draft) {
  const FREE = cfgInt(env, "FREE_PAGES_PER_DAY", 5);
  const PRICE = cfgInt(env, "PRICE_PER_PAGE_CENTS", 10);

  const used = await getUsedPages(env, draft.verifiedEmail);
  const freeLeft = Math.max(0, FREE - used);
  const paidPages = Math.max(0, draft.pages - freeLeft);

  return { used, freeLeft, paidPages, dueCents: paidPages * PRICE };
}

async function faxPrice(url, env) {
  const submission_id = (url.searchParams.get("submission_id") || "").trim();
  if (!submission_id) return bad(400, "Missing submission_id.");

  const draftRaw = await env.FAX_KV.get(KV_PREFIX + submission_id);
  if (!draftRaw) return bad(404, "Draft not found.");

  const draft = JSON.parse(draftRaw);
  if (!draft.verified) return bad(403, "Email not verified.");

  const pricing = await computePrice(env, draft);
  return json(pricing, 200);
}

// ----------------- SINCH SEND -----------------
// Sinch send payload uses contentUrl (not url). :contentReference[oaicite:0]{index=0}

async function sendViaSinch(env, { to, from, contentUrl }) {
  const auth = btoa(`${env.SINCH_ACCESS_KEY}:${env.SINCH_ACCESS_SECRET}`);

  const r = await fetch(`https://fax.api.sinch.com/v3/projects/${env.SINCH_PROJECT_ID}/faxes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Basic ${auth}`,
    },
    body: JSON.stringify({
      to,
      from,
      contentUrl,
    }),
  });

  const j = await r.json().catch(() => null);
  return { ok: r.ok && !!j, raw: j };
}


async function sendFax(req, env) {
  const body = await req.json().catch(() => null);
  const submission_id = String(body?.submission_id || "").trim();
  if (!submission_id) return bad(400, "Missing submission_id.");

  const draftRaw = await env.FAX_KV.get(KV_PREFIX + submission_id);
  if (!draftRaw) return bad(404, "Draft not found.");

  const draft = JSON.parse(draftRaw);

  if (!draft.verified) return bad(403, "Email not verified.");
  if (draft.sent) return bad(409, "Already sent.");

  const pricing = await computePrice(env, draft);
  if (pricing.dueCents > 0 && !draft.paid) {
    return json({ error: "Payment required.", pricing }, 402);
  }

  const sinchRes = await sendViaSinch(env, { to: draft.to, from: draft.from, contentUrl: draft.contentUrl });

  if (!sinchRes.ok) {
    draft.lastStatus = "sinch_error";
    await env.FAX_KV.put(KV_PREFIX + submission_id, JSON.stringify(draft), { expirationTtl: 3600 });
    return json({ error: "Fax provider error.", sinch: sinchRes.raw }, 502);
  }

  draft.sent = true;
  draft.sinchFaxId = sinchRes.raw?.id || null;
  draft.lastStatus = "queued";

  await env.FAX_KV.put(KV_PREFIX + submission_id, JSON.stringify(draft), { expirationTtl: 3600 });

  // count pages after successful send
  await addUsedPages(env, draft.verifiedEmail, draft.pages);

  return json({ status: "queued", pages: draft.pages, fax_id: draft.sinchFaxId }, 200);
}

// ----------------- STRIPE CHECKOUT -----------------
// Disabled: this build does not create Stripe checkout sessions.

export class UsageDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // current total pages used today
    if (request.method === "GET" && path === "/used") {
      const used = (await this.state.storage.get("used")) || 0;
      return new Response(JSON.stringify({ used }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // add pages after a successful fax send
    if (request.method === "POST" && path === "/add") {
      const body = await request.json().catch(() => ({}));
      const pages = Number(body.pages || 0);
      if (!Number.isFinite(pages) || pages <= 0) {
        return new Response(JSON.stringify({ error: "Invalid pages" }), {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      const cur = (await this.state.storage.get("used")) || 0;
      const next = cur + pages;
      await this.state.storage.put("used", next);

      return new Response(JSON.stringify({ used: next }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}
