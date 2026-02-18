# ===============================
# SureWhyNot Site Audit Script
# ===============================

$domain = "https://surewhynot.app"

$urls = @(
    "$domain/",
    "$domain/ads.txt",
    "$domain/robots.txt",
    "$domain/sitemap.xml"
)

Write-Host "`n========== BASIC SITE CHECK =========="

foreach ($url in $urls) {
    Write-Host "`n===== $url ====="

    try {
        $r = Invoke-WebRequest -Uri $url -Method GET -MaximumRedirection 5 -ErrorAction Stop

        Write-Host "Status: $($r.StatusCode)"
        Write-Host "Content-Type: $($r.Headers.'Content-Type')"
        Write-Host "Server: $($r.Headers.Server)"
        Write-Host "Cache-Control: $($r.Headers.'Cache-Control')"
        Write-Host "X-Robots-Tag: $($r.Headers.'X-Robots-Tag')"
        Write-Host "CSP: $($r.Headers.'Content-Security-Policy')"
        Write-Host "X-Frame-Options: $($r.Headers.'X-Frame-Options')"
        Write-Host "Referrer-Policy: $($r.Headers.'Referrer-Policy')"
        Write-Host "Permissions-Policy: $($r.Headers.'Permissions-Policy')"
        Write-Host "Strict-Transport-Security: $($r.Headers.'Strict-Transport-Security')"

        Write-Host "`n---- First 60 lines of body ----"
        ($r.Content -split "`n" | Select-Object -First 60) -join "`n"

    } catch {
        Write-Host "ERROR: $($_.Exception.Message)"
    }
}

# ===============================
# AdSense Detection
# ===============================

Write-Host "`n========== ADSENSE CHECK =========="

try {
    $home = Invoke-WebRequest "$domain/" -UseBasicParsing
    $adsense = $home.Content | Select-String -Pattern "pagead2\.googlesyndication\.com" -AllMatches

    if ($adsense) {
        Write-Host "AdSense script detected."
    } else {
        Write-Host "AdSense script NOT detected."
    }
} catch {
    Write-Host "Homepage fetch failed."
}

# ===============================
# Link Map
# ===============================

Write-Host "`n========== HOMEPAGE LINKS =========="

try {
    ($home.Links | Select-Object -ExpandProperty href) |
        Sort-Object -Unique |
        ForEach-Object { Write-Host $_ }
} catch {
    Write-Host "Could not extract links."
}

# ===============================
# Save Local Snapshots
# ===============================

Write-Host "`n========== SAVING SNAPSHOTS =========="

try {
    $home.Content | Out-File -Encoding utf8 .\audit_home.html
    Invoke-WebRequest "$domain/robots.txt" -OutFile .\audit_robots.txt -ErrorAction SilentlyContinue
    Invoke-WebRequest "$domain/sitemap.xml" -OutFile .\audit_sitemap.xml -ErrorAction SilentlyContinue
    Invoke-WebRequest "$domain/ads.txt" -OutFile .\audit_ads.txt -ErrorAction SilentlyContinue

    Write-Host "Saved:"
    Write-Host " - audit_home.html"
    Write-Host " - audit_robots.txt"
    Write-Host " - audit_sitemap.xml"
    Write-Host " - audit_ads.txt"
} catch {
    Write-Host "Snapshot save failed."
}

Write-Host "`n========== DONE =========="
