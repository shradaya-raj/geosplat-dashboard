param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path,

  [string]$Repo = "shradaya-raj/geosplat-dashboard",

  [string]$Tag = "models"
)

$ErrorActionPreference = "Stop"
$supportedExtensions = @(".ply", ".splat", ".ksplat", ".spz")

$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCommand) {
  $fallbackGh = "C:\Program Files\GitHub CLI\gh.exe"
  if (Test-Path $fallbackGh) {
    $gh = $fallbackGh
  } else {
    throw "GitHub CLI was not found. Install it, then run gh auth login."
  }
} else {
  $gh = $ghCommand.Source
}

& $gh release view $Tag --repo $Repo *> $null
if ($LASTEXITCODE -ne 0) {
  & $gh release create $Tag --repo $Repo --title "Gaussian model assets" --notes "Large Gaussian splat files used by the GitHub Pages dashboard."
}

foreach ($item in $Path) {
  $resolvedPath = Resolve-Path -LiteralPath $item
  $extension = [System.IO.Path]::GetExtension($resolvedPath).ToLowerInvariant()

  if ($supportedExtensions -notcontains $extension) {
    throw "Unsupported model file '$resolvedPath'. Use .ply, .splat, .ksplat, or .spz."
  }

  Write-Host "Uploading $resolvedPath to release '$Tag'..."
  & $gh release upload $Tag $resolvedPath --repo $Repo --clobber
}

Write-Host "Triggering GitHub Pages deployment..."
& $gh workflow run deploy-pages.yml --repo $Repo

Write-Host "Done. The model will appear after the GitHub Pages workflow finishes."
