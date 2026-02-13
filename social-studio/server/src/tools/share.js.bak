// social-studio/server/src/routes/tools.js
import express from "express";
import { buildInvoice } from "../tools/invoice.js";

const router = express.Router();

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

/* REPLACE ONLY THIS ROUTE */
router.post("/api/tools/invoice", (req, res) => {
  const invoice = buildInvoice(req.body || {});
  res.json({
    ok: true,
    tool: "invoice",
    status: "working",
    accepted: true,
    invoice,
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
