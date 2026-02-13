// social-studio/server/src/routes/tools.js
import express from "express";

const router = express.Router();

/*
  Placeholder “business tools” endpoints.
  These just prove the API wiring works.
*/

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

router.post("/api/tools/pdf/merge", (req, res) => {
  const fileSizeBytes = num(req.body?.fileSizeBytes, 0);
  res.json({
    ok: true,
    tool: "pdf/merge",
    status: "placeholder",
    accepted: true,
    fileSizeBytes,
    message: "Queued (stub). Implement real PDF merge later.",
  });
});

router.post("/api/tools/pdf/compress", (req, res) => {
  const fileSizeBytes = num(req.body?.fileSizeBytes, 0);
  res.json({
    ok: true,
    tool: "pdf/compress",
    status: "placeholder",
    accepted: true,
    fileSizeBytes,
    message: "Queued (stub). Implement real PDF compress later.",
  });
});

router.post("/api/tools/invoice", (req, res) => {
  res.json({
    ok: true,
    tool: "invoice",
    status: "placeholder",
    accepted: true,
    invoiceId: `inv_${Date.now()}`,
    message: "Generated (stub). Implement real invoice generator later.",
  });
});

router.post("/api/tools/share", (req, res) => {
  const expiryHours = Math.max(1, Math.min(72, num(req.body?.expiryHours, 6)));
  const expiresAt = Date.now() + expiryHours * 60 * 60 * 1000;

  res.json({
    ok: true,
    tool: "share",
    status: "placeholder",
    accepted: true,
    url: `https://example.com/share/${Date.now()}`,
    expiresAt,
    message: "Created (stub). Implement real expiring links + storage later.",
  });
});

export default router;
