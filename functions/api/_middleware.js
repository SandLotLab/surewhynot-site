export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // ✅ ADD THIS: only rate limit these expensive endpoints
  const PROTECTED_PATHS = new Set([
    "/api/chat",
  ]);
  const isProtected =
    PROTECTED_PATHS.has(url.pathname) ||
    url.pathname.startsWith("/api/fax/"); // keeps your existing fax/* behavior

  // ✅ CHANGE THIS: if NOT protected, skip rate limit entirely
  if (!isProtected) {
    return next();
  }

  // (everything below stays the same)

  // 2) Identify caller (IP)
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";

  // 3) Decide limit per endpoint
  let limit = 60;     // default
  let windowSec = 60; // default window

  if (url.pathname.startsWith("/api/fax/")) {
    limit = 5;
    windowSec = 60;
  }

  // 4) Make key per (endpoint + ip) so chat can’t block fax
  const bucket = url.pathname.startsWith("/api/fax/") ? "fax" : "api";
  const key = `${bucket}:${ip}`;

  // 5) Read current count
  const raw = await env.RATE_KV.get(key);
  const count = raw ? Number(raw) : 0;

  // 6) Block if over limit
  if (count >= limit) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }

  // 7) Increment and set TTL so it resets every window
  const nextCount = count + 1;
  await env.RATE_KV.put(key, String(nextCount), { expirationTtl: windowSec });

  // 8) Continue to your API handler
  return next();
}
