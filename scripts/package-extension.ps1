param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$manifestPath = Join-Path $ProjectRoot 'manifest.json'
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
$outputDir = Join-Path $ProjectRoot 'dist'
$outputPath = Join-Path $outputDir "octolens-$($manifest.version)-chrome.zip"

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
if (Test-Path -LiteralPath $outputPath) {
  Remove-Item -LiteralPath $outputPath -Force
}

Push-Location $ProjectRoot
try {
  Compress-Archive -Path @('manifest.json', 'src', 'icons') -DestinationPath $outputPath -CompressionLevel Optimal
}
finally {
  Pop-Location
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($outputPath)
try {
  $entries = @($archive.Entries | ForEach-Object FullName)
  if ($entries -notcontains 'manifest.json') {
    throw 'The package is invalid: manifest.json is not at the archive root.'
  }
  if ($entries | Where-Object { $_ -match '(^|/)(\.git|node_modules|assets|store|scripts)/' }) {
    throw 'The package includes a development-only directory.'
  }
}
finally {
  $archive.Dispose()
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $outputPath).Length

[PSCustomObject]@{
  Path = $outputPath
  Version = $manifest.version
  Bytes = $size
  Sha256 = $hash
}
