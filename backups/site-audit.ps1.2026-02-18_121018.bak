$baseUrl = "https://surewhynot.app"
$adsClient = "ca-pub-7167291111213614"

Write-Host ""
Write-Host "========== BASIC SITE CHECK ==========" -ForegroundColor Cyan
Write-Host ""

function Fetch-Url($url) {
    try {
        return Invoke-WebRequest $url `
            -UseBasicParsing `
            -Headers @{ "User-Agent" = "Mozilla/5.0" }
    }
    catch {
        Write-Host "Fetch failed for $url" -ForegroundColor Red
        Write-Host $_.Exception.Message
        return $null
    }
}

# ----------------------------
# HOMEPAGE
# ----------------------------
Write-Host "===== $baseUrl/ =====" -ForegroundColor Yellow
$home = Fetch-Url "$baseUrl/"

if ($home) {
    Write-Host "Status:" $home.StatusCode
    Write-Host "Content-Type:" $home.Headers["Content-Type"]
    Write-Host "Server:" $home.Headers["Server"]
    Write-Host ""
    Write-Host "---- First 60 lines of body ----"
    ($home.Content -split "`n")[0..59]
}

# ----------------------------
# ADS.TXT
# ----------------------------
Write-Host ""
Write-Host "===== $baseUrl/ads.txt =====" -ForegroundColor Yellow
$ads = Fetch-Url "$baseUrl/ads.txt"

if ($ads) {
    Write-Host "Status:" $ads.StatusCode
    Write-Host "Content-Type:" $ads.Headers["Content-Type"]
    Write-Host ""
    Write-Host $ads.Content
}

# ----------------------------
# ROBOTS.TXT
# ----------------------------
Write-Host ""
Write-Host "===== $baseUrl/robots.txt =====" -ForegroundColor Yellow
$robots = Fetch-Url "$baseUrl/robots.txt"

if ($robots) {
    Write-Host "Status:" $robots.StatusCode
    Write-Host "Content-Type:" $robots.Headers["Content-Type"]
    Write-Host ""
    Write-Host $robots.Content
}

# ----------------------------
# SITEMAP
# ----------------------------
Write-Host ""
Write-Host "===== $baseUrl/sitemap.xml =====" -ForegroundColor Yellow
$sitemap = Fetch-Url "$baseUrl/sitemap.xml"

if ($sitemap) {
    Write-Host "Status:" $sitemap.StatusCode
    Write-Host "Content-Type:" $sitemap.Headers["Content-Type"]
    Write-Host ""
    Write-Host ($sitemap.Content -split "`n")[0..30]
}

# ----------------------------
# ADSENSE CHECK
# ----------------------------
Write-Host ""
Write-Host "========== ADSENSE CHECK ==========" -ForegroundColor Cyan

if ($home -and ($home.Content -match $adsClient)) {
    Write-Host "AdSense client found on homepage." -ForegroundColor Green
}
else {
    Write-Host "AdSense client NOT found on homepage." -ForegroundColor Red
}

if ($ads -and ($ads.Content -match $adsClient)) {
    Write-Host "AdSense client found in ads.txt." -ForegroundColor Green
}
else {
    Write-Host "AdSense client NOT found in ads.txt." -ForegroundColor Red
}

Write-Host ""
Write-Host "========== DONE ==========" -ForegroundColor Cyan
Write-Host ""
