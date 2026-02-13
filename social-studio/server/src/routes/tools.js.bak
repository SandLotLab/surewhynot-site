// social-studio/server/src/routes/tools.js
import express from "express";
import { createShare, getShare } from "../tools/share.js";

const router = express.Router();

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* PDF endpoints still stubbed */
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

/* Invoice (still stub) */
router.post("/api/tools/invoice", (_req, res) => {
  res.json({
    ok: true,
    tool: "invoice",
    status: "working",
    accepted: true,
    invoiceId: `inv_${Date.now()}`,
    message: "Generated (still stub output).",
  });
});

/* Share (now “working”) */
router.post("/api/tools/share", (req, res) => {
  const expiryHours = num(req.body?.expiryHours, 6);
  const fileSizeBytes = num(req.body?.fileSizeBytes, 0);

  const created = createShare({ expiryHours, fileSizeBytes });

  res.json({
    ok: true,
    tool: "share",
    status: "working",
    accepted: true,
    shareId: created.shareId,
    expiresAt: created.expiresAt,
    downloadUrl: `/social-studio/api/tools/share/download/${created.shareId}`,
  });
});

/* Download (placeholder response, but wired + expiry enforced) */
router.get("/api/tools/share/download/:shareId", (req, res) => {
  const share = getShare(req.params.shareId);

  if (!share) return res.status(404).json({ ok: false, error: "share not found" });
  if (Date.now() > share.expiresAt) return res.status(410).json({ ok: false, error: "share expired" });

  res.json({
    ok: true,
    shareId: share.shareId,
    status: "working",
    message: "Download endpoint wired. Attach real file bytes later.",
  });
});

export default router;
