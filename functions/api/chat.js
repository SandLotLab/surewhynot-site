export async function onRequestPost({ request }) {
  const body = await request.json().catch(() => ({}));
  const { room, userId, displayName, text } = body;

  if (!room || !userId || !text) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // v1: echo back (no DB yet)
  const message = {
    id: crypto.randomUUID(),
    room,
    userId,
    displayName: displayName || "anon",
    text,
    createdAt: Date.now(),
  };

  return new Response(JSON.stringify({ ok: true, message }), {
    headers: { "content-type": "application/json" },
  });
}
