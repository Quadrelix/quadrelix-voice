# Creates the pilot shops on the live backend and prints each shop's 6-character code.
#
#   cd backend\scripts
#   powershell -ExecutionPolicy Bypass -File .\create-shops.ps1
#
# It asks for ONE thing: the ADMIN_TOKEN (typed hidden, never echoed or saved).
# It does not ask for UPI ids, phone numbers or bill text. The owner types the code
# on the app's first screen together with their shop name and mobile number, and
# later sets their UPI id and a 1-2 line thank-you note in Shop details.
# The names below are only YOUR labels (they show up in the admin list); the owner's
# own shop name replaces them when they first open the app.
#
# Run this AFTER the backend that accepts shop-name updates is live.

param([string]$BaseUrl = "https://quadrelix-voice-backend.onrender.com")

$secure = Read-Host "ADMIN_TOKEN" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $token) { Write-Error "No token entered"; exit 1 }

$shops = @(
  @{ name = "Pankhudi Saree Center"; type = "kapda" },
  @{ name = "Manish Kirana Store"; type = "kirana" },
  # Team-only shop for the voice test (see docs/VOICE_CALIBRATION.md). Fixed fake
  # details; never give its code to a real shopkeeper.
  @{ name = "TEST Team"; type = "kirana"; upi = "test@upi"; phone = "9999999999" }
)

foreach ($s in $shops) {
  $body = @{ shop_name = $s.name; shop_type = $s.type }
  if ($s.upi) { $body.upi_id = $s.upi }
  if ($s.phone) { $body.owner_phone = $s.phone }
  $json = $body | ConvertTo-Json
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/shops" `
      -Headers @{ Authorization = "Bearer $token" } `
      -ContentType "application/json; charset=utf-8" `
      -Body ([Text.Encoding]::UTF8.GetBytes($json))
    Write-Host ("{0}  ->  CODE {1}   (shop_id {2})" -f $r.shop.shop_name, $r.shop.shop_code, $r.shop.shop_id) -ForegroundColor Green
  } catch {
    Write-Host "Could not create $($s.name): $($_.Exception.Message)" -ForegroundColor Red
  }
}
Write-Host ""
Write-Host "Give each owner ONLY their own code. Do not paste the codes anywhere public."
