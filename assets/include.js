(async () => {
  const load = async (id, url) => {
    const el = document.getElementById(id);
    if (!el) return;
    const res = await fetch(url, { cache: "no-cache" });
    el.innerHTML = await res.text();
  };

  await load("site-header", "/header.html");
  await load("site-footer", "/footer.html");
})();
