# Creates the pilot shops on the live backend and prints each shop's 6-character code.
#
#   cd backend\scripts
#   powershell -ExecutionPolicy Bypass -File .\create-shops.ps1
#
# It asks for ONE thing: the ADMIN_TOKEN (typed hidden, never echoed or saved). It
# does not ask for UPI ids or phone numbers: the shop owner logs in with the code
# and enters their own payment details in the app (Home -> shop name -> Shop details).
# Until they do, bills simply have no pay QR.
# The bill footer text is printed under every bill of that shop (emoji are dropped by
# the server on purpose). Run this AFTER the backend with the bill_footer column is live.
# Change a footer later with:  PATCH /api/admin/shops/<shop_id>  {"bill_footer": "..."}

param([string]$BaseUrl = "https://quadrelix-voice-backend.onrender.com")

$secure = Read-Host "ADMIN_TOKEN" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $token) { Write-Error "No token entered"; exit 1 }

$shops = @(
  @{
    name = "Pankhudi Saree Center"; type = "kapda"
    footer = @"
PANKHUDI SAREE CENTER

Dear Customer,

Thank you for choosing us!

Your bill is attached for your reference.

Your trust makes us special.

Thank you for shopping with us.
We look forward to seeing you again!

Thank You & Visit Again!

Pankhudi Saree Center
Elegance in Every Thread.
"@
  },
  @{
    name = "Manish Kirana Store"; type = "kirana"
    footer = @"
MANISH KIRANA STORE

Namaste Ji!

Thank you for shopping with us!

Your bill is attached for your reference.

Aapka bharosa hi hamari pehchaan hai.

Phir se zaroor padhariye!

Dhanyavaad & Visit Again!

Manish Kirana Store
Aapki Apni Dukaan!
"@
  },
  @{
    # Team-only shop for the voice test (see docs/VOICE_CALIBRATION.md). Fixed fake
    # details, so it asks nothing and must never be given to a real shopkeeper.
    name = "TEST Team"; type = "kirana"; upi = "test@upi"; phone = "9999999999"; footer = ""
  }
)

foreach ($s in $shops) {
  $body = @{ shop_name = $s.name; shop_type = $s.type; bill_footer = $s.footer }
  # only the team TEST shop has fixed fake payment details
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
Write-Host "Owners add their own UPI id and phone in the app after logging in with their code."
