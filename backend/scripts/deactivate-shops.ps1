# Switches OFF the old demo/test shops on the live backend, so their codes stop working.
#
#   cd backend\scripts
#   powershell -ExecutionPolicy Bypass -File .\deactivate-shops.ps1
#
# It deactivates (active=false); it does NOT delete. The shop's code is refused at once, nothing
# can be billed into it, but its data stays and can be switched back on with
#   PATCH /api/admin/shops/<shop_id>   {"active": true}
# It lists the shops first, shows exactly which ones it will switch off, and waits for you to
# type YES. Shops not on the list (Pankhudi, Manish, TEST Team, ...) are never touched.
#
# Asks for ADMIN_TOKEN (typed hidden), or reads $env:ADMIN_TOKEN if you set it for this window.

param(
  [string]$BaseUrl = "https://quadrelix-voice-backend.onrender.com",
  # Exact shop names to switch off (case-insensitive). Override with -Names "A","B".
  [string[]]$Names = @("Sharma Kapda Store", "Gupta Kirana Store", "TEST Shop (delete me)", "Demo (legacy data)"),
  [switch]$Yes   # skip the YES question (for scripts/tests)
)

$token = $env:ADMIN_TOKEN
if (-not $token) {
  $secure = Read-Host "ADMIN_TOKEN" -AsSecureString
  $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if (-not $token) { Write-Error "No token entered"; exit 1 }
$headers = @{ Authorization = "Bearer $token" }

function Get-Shops {
  (Invoke-RestMethod -Uri "$BaseUrl/api/admin/shops" -Headers $headers).shops
}

try { $shops = @(Get-Shops) } catch {
  Write-Host "Could not read the shop list: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Shops on the server right now:"
$shops | Select-Object shop_name, shop_code, active | Format-Table -AutoSize

$wanted = $Names | ForEach-Object { $_.Trim().ToLower() }
$targets = @($shops | Where-Object { $wanted -contains $_.shop_name.Trim().ToLower() -and $_.active -ne $false })

if ($targets.Count -eq 0) {
  Write-Host "Nothing to switch off: none of the listed shops are active." -ForegroundColor Yellow
  exit 0
}

Write-Host "These $($targets.Count) shop(s) will be SWITCHED OFF (codes stop working, data is kept):" -ForegroundColor Yellow
$targets | Select-Object shop_name, shop_code | Format-Table -AutoSize

if (-not $Yes) {
  $answer = Read-Host "Type YES to continue"
  if ($answer -cne "YES") { Write-Host "Cancelled. Nothing was changed."; exit 0 }
}

foreach ($s in $targets) {
  try {
    [void](Invoke-RestMethod -Method Patch -Uri "$BaseUrl/api/admin/shops/$($s.shop_id)" `
      -Headers $headers -ContentType "application/json" -Body '{"active": false}')
    Write-Host ("switched off: {0} ({1})" -f $s.shop_name, $s.shop_code) -ForegroundColor Green
  } catch {
    Write-Host ("FAILED: {0}: {1}" -f $s.shop_name, $_.Exception.Message) -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "Shops now:"
@(Get-Shops) | Select-Object shop_name, shop_code, active | Format-Table -AutoSize
