// social-studio/server/src/routes/tools.js
import express from "express";
import { randomUUID } from "crypto";

const router = express.Router();

// In-memory share store (must be at module scope so GET can see POST results)
const shares = new Map(); // shareId -> { createdAt, expiresAt, fileSizeBytes }

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

router.post("/api/tools/invoice", (_req, res) => {
  res.json({
    ok: true,
    tool: "invoice",
    status: "placeholder",
    accepted: true,
    invoiceId: `inv_${Date.now()}`,
    message: "Generated (stub). Implement real invoice generator later.",
  });
});

/**
 * Create an expiring “share”
 * Body: { expiryHours: number, fileSizeBytes: number }
 */
router.post("/api/tools/share", (req, res) => {
  const expiryHours = Math.max(1, Math.min(72, num(req.body?.expiryHours, 6)));
  const fileSizeBytes = Math.max(0, num(req.body?.fileSizeBytes, 0));

  const shareId = `shr_${randomUUID()}`;
  const createdAt = Date.now();
  const expiresAt = createdAt + expiryHours * 60 * 60 * 1000;

  shares.set(shareId, { createdAt, expiresAt, fileSizeBytes });

  res.json({
    ok: true,
    tool: "share",
    status: "working",
    accepted: true,
    shareId,
    expiresAt,
    downloadUrl: `/social-studio/api/tools/share/download/${shareId}`,
  });
});

/**
 * Download the “shared file”
 * This is a stub that just returns bytes of the requested size.
 */
router.get("/api/tools/share/download/:shareId", (req, res) => {
  const shareId = String(req.params.shareId || "").trim();
  const record = shares.get(shareId);

  if (!record) return res.status(404).json({ ok: false, error: "share not found" });
  if (Date.now() > record.expiresAt) {
    shares.delete(shareId);
    return res.status(410).json({ ok: false, error: "share expired" });
  }

  const size = Math.min(record.fileSizeBytes || 0, 5 * 1024 * 1024); // cap 5MB
  const buf = Buffer.alloc(size, 0);

  res.setHeader("content-type", "application/octet-stream");
  res.setHeader("content-length", String(buf.length));
  res.setHeader("content-disposition", `attachment; filename="${shareId}.bin"`);
  res.send(buf);
});

export default router;
