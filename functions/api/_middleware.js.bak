const WINDOW_SECONDS = 60;
const LIMIT = 60; // 60 requests per 60s per IP

function getIP(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function onRequest(context) {
  const { request, env, next } = context;

  // Only limit API calls (this middleware lives under /api already)
  const ip = getIP(request);
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / WINDOW_SECONDS);
  const key = `rl:${ip}:${bucket}`;

  const currentRaw = await env.RATE_KV.get(key);
  const current = currentRaw ? parseInt(currentRaw, 10) : 0;

  if (current >= LIMIT) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  // increment + keep it alive for the window
  await env.RATE_KV.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS });

  return next();
}
