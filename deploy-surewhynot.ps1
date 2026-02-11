$ErrorActionPreference = "Stop"

# ===== CONFIG =====
$RepoRoot   = "C:\Users\BigHomieCed\Desktop\GitHub\surewhynot-site"
$WorkerPath = Join-Path $RepoRoot "workers\fax-worker"
$CommitMsg  = "fax paywall + 24h per-device usage + stripe key validation"

Write-Host "== 1) Go to repo root ==" -ForegroundColor Cyan
Set-Location $RepoRoot

Write-Host "== 2) Show branch / status ==" -ForegroundColor Cyan
git branch --show-current
git remote -v
git status -s

Write-Host "== 3) Verify key code markers ==" -ForegroundColor Cyan
git grep "DEVICE_ID_KEY" pages/fax.html
git grep "getStripeSecretKey" workers/fax-worker/src/worker.js
git grep "starts with sk_" workers/fax-worker/src/worker.js

Write-Host "== 4) Commit + push main (if needed) ==" -ForegroundColor Cyan
$changes = git status --porcelain
if ($changes) {
  git add .
  git commit -m $CommitMsg
  git push origin main
} else {
  Write-Host "No local git changes found. Pushing main anyway..." -ForegroundColor Yellow
  git push origin main
}

Write-Host "== 5) Deploy worker from workers/fax-worker ==" -ForegroundColor Cyan
Set-Location $WorkerPath
npx wrangler deploy

Write-Host "✅ DONE" -ForegroundColor Green
Write-Host "If Stripe key changed, run this once then deploy again:"
Write-Host "npx wrangler secret put STRIPE_SECRET_KEY" -ForegroundColor Yellow
