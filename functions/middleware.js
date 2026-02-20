export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  const host = request.headers.get("host") || "";

  if (host.endsWith(".pages.dev")) {
    url.host = "surewhynot.app";
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }

  return next();
}