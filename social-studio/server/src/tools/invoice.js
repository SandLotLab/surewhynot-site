export function buildInvoice({ from, to, items, invoiceNumber }) {
  const safe = (s) => String(s ?? "").trim();

  const cleanItems = (Array.isArray(items) ? items : []).map((it) => ({
    desc: safe(it?.desc).slice(0, 120),
    qty: Number(it?.qty ?? 1),
    rate: Number(it?.rate ?? 0),
  })).filter((it) => it.desc && Number.isFinite(it.qty) && Number.isFinite(it.rate));

  const subtotal = cleanItems.reduce((sum, it) => sum + it.qty * it.rate, 0);
  const tax = 0;
  const total = subtotal + tax;

  return {
    invoiceNumber: safe(invoiceNumber) || `INV-${Date.now()}`,
    from: safe(from) || "Your Business",
    to: safe(to) || "Customer",
    items: cleanItems,
    subtotal,
    tax,
    total,
    createdAt: Date.now(),
  };
}
