# Copies exactly the files a Hugging Face Space needs into a cloned Space repo.
#   git clone https://huggingface.co/spaces/<user>/<space-name> C:\path\to\space
#   .\make-space.ps1 -SpaceDir C:\path\to\space
param([Parameter(Mandatory = $true)][string]$SpaceDir)

$src = Split-Path -Parent $PSScriptRoot
foreach ($f in "Dockerfile", "requirements.txt", "main.py", "speaker.py", "store.py", "pgstore.py") {
    Copy-Item (Join-Path $src $f) $SpaceDir -Force
}
Copy-Item (Join-Path $PSScriptRoot "README.md") $SpaceDir -Force
Write-Host "Copied to $SpaceDir. Next: cd there, git add ., git commit, git push."
