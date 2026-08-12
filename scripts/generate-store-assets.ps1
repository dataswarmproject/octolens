param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$outputDir = Join-Path $ProjectRoot 'store\assets'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

function New-Color([string]$hex, [int]$alpha = 255) {
  $value = $hex.TrimStart('#')
  return [System.Drawing.Color]::FromArgb(
    $alpha,
    [Convert]::ToInt32($value.Substring(0, 2), 16),
    [Convert]::ToInt32($value.Substring(2, 2), 16),
    [Convert]::ToInt32($value.Substring(4, 2), 16)
  )
}

function New-RoundedPath([System.Drawing.RectangleF]$rect, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Canvas([int]$width, [int]$height) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $rect = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $rect,
    (New-Color '#101b2a'),
    (New-Color '#080d14'),
    20
  )
  $graphics.FillRectangle($gradient, $rect)
  $gradient.Dispose()

  $gridPen = [System.Drawing.Pen]::new((New-Color '#2a4668' 46), 1)
  for ($x = 0; $x -lt $width; $x += 48) { $graphics.DrawLine($gridPen, $x, 0, $x, $height) }
  for ($y = 0; $y -lt $height; $y += 48) { $graphics.DrawLine($gridPen, 0, $y, $width, $y) }
  $gridPen.Dispose()

  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Draw-ImageCard(
  [System.Drawing.Graphics]$graphics,
  [System.Drawing.Image]$image,
  [System.Drawing.RectangleF]$destination,
  [System.Drawing.RectangleF]$source,
  [float]$radius = 14
) {
  $shadowRect = [System.Drawing.RectangleF]::new(
    $destination.X + 8, $destination.Y + 12, $destination.Width, $destination.Height
  )
  $shadowPath = New-RoundedPath $shadowRect $radius
  $shadowBrush = [System.Drawing.SolidBrush]::new((New-Color '#000000' 105))
  $graphics.FillPath($shadowBrush, $shadowPath)
  $shadowBrush.Dispose()
  $shadowPath.Dispose()

  $path = New-RoundedPath $destination $radius
  $state = $graphics.Save()
  $graphics.SetClip($path)
  $graphics.DrawImage($image, $destination, $source, [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.Restore($state)
  $borderPen = [System.Drawing.Pen]::new((New-Color '#3d5875'), 1.5)
  $graphics.DrawPath($borderPen, $path)
  $borderPen.Dispose()
  $path.Dispose()
}

function Draw-Text(
  [System.Drawing.Graphics]$graphics,
  [string]$text,
  [float]$x,
  [float]$y,
  [float]$size,
  [string]$color,
  [System.Drawing.FontStyle]$style = [System.Drawing.FontStyle]::Regular
) {
  $font = [System.Drawing.Font]::new('Segoe UI', $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = [System.Drawing.SolidBrush]::new((New-Color $color))
  $graphics.DrawString($text, $font, $brush, $x, $y)
  $brush.Dispose()
  $font.Dispose()
}

function Save-Canvas($canvas, [string]$name) {
  $path = Join-Path $outputDir $name
  $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Dispose()
  Write-Output $path
}

$strip = [System.Drawing.Image]::FromFile((Join-Path $ProjectRoot 'assets\screenshot-strip.png'))
$popup = [System.Drawing.Image]::FromFile((Join-Path $ProjectRoot 'assets\screenshot-popup.png'))
$hover = [System.Drawing.Image]::FromFile((Join-Path $ProjectRoot 'assets\screenshot-hovercard.png'))
$icon = [System.Drawing.Image]::FromFile((Join-Path $ProjectRoot 'icons\icon-512.png'))

try {
  $shot1 = New-Canvas 1280 800
  Draw-Text $shot1.Graphics 'Find the right repository faster' 60 42 48 '#f0f6fc' ([System.Drawing.FontStyle]::Bold)
  Draw-Text $shot1.Graphics 'Relevant alternatives and project signals, directly inside GitHub.' 62 105 23 '#9db3c8'
  Draw-ImageCard $shot1.Graphics $strip ([System.Drawing.RectangleF]::new(60, 180, 1160, 560)) ([System.Drawing.RectangleF]::new(0, 0, 1160, 560)) 14
  Save-Canvas $shot1 'screenshot-01-discovery.png'

  $shot2 = New-Canvas 1280 800
  Draw-Text $shot2.Graphics 'Preview, search, save, and remember' 60 42 48 '#f0f6fc' ([System.Drawing.FontStyle]::Bold)
  Draw-Text $shot2.Graphics 'A focused GitHub workspace that stays in your browser profile.' 62 105 23 '#9db3c8'
  Draw-Text $shot2.Graphics 'SEARCH AND PERSONALIZE' 76 172 15 '#79c0ff' ([System.Drawing.FontStyle]::Bold)
  Draw-ImageCard $shot2.Graphics $popup ([System.Drawing.RectangleF]::new(76, 206, 430, 490)) ([System.Drawing.RectangleF]::new(0, 0, 392, 446)) 14
  Draw-Text $shot2.Graphics 'PREVIEW WITHOUT LEAVING THE PAGE' 548 172 15 '#79c0ff' ([System.Drawing.FontStyle]::Bold)
  Draw-ImageCard $shot2.Graphics $hover ([System.Drawing.RectangleF]::new(548, 206, 672, 324)) ([System.Drawing.RectangleF]::new(0, 0, 560, 270)) 14
  Draw-Text $shot2.Graphics 'Local bookmarks' 570 576 22 '#f0f6fc' ([System.Drawing.FontStyle]::Bold)
  Draw-Text $shot2.Graphics 'Private notes' 820 576 22 '#f0f6fc' ([System.Drawing.FontStyle]::Bold)
  Draw-Text $shot2.Graphics 'Portable backup' 1022 576 22 '#f0f6fc' ([System.Drawing.FontStyle]::Bold)
  Draw-Text $shot2.Graphics 'No OctoLens account, analytics, ads, or tracking backend.' 570 632 20 '#9db3c8'
  Save-Canvas $shot2 'screenshot-02-workspace.png'

  $tile = New-Canvas 440 280
  $tile.Graphics.DrawImage($icon, [System.Drawing.RectangleF]::new(28, 62, 148, 148))
  Draw-Text $tile.Graphics 'OctoLens' 194 72 40 '#f0f6fc' ([System.Drawing.FontStyle]::Bold)
  Draw-Text $tile.Graphics 'See beyond the' 196 129 20 '#9db3c8'
  Draw-Text $tile.Graphics 'repository.' 196 155 20 '#79c0ff' ([System.Drawing.FontStyle]::Bold)
  Draw-Text $tile.Graphics 'LOCAL-FIRST GITHUB DISCOVERY' 30 234 12 '#79c0ff' ([System.Drawing.FontStyle]::Bold)
  Save-Canvas $tile 'promo-small-440x280.png'

  $marquee = New-Canvas 1400 560
  $marquee.Graphics.DrawImage($icon, [System.Drawing.RectangleF]::new(78, 131, 220, 220))
  Draw-Text $marquee.Graphics 'OctoLens' 340 126 74 '#f0f6fc' ([System.Drawing.FontStyle]::Bold)
  Draw-Text $marquee.Graphics 'See beyond the repository.' 346 221 30 '#79c0ff' ([System.Drawing.FontStyle]::Bold)
  Draw-Text $marquee.Graphics 'Relevant alternatives. Fast previews.' 346 276 23 '#9db3c8'
  Draw-Text $marquee.Graphics 'A private local workspace for GitHub.' 346 310 23 '#9db3c8'
  Draw-ImageCard $marquee.Graphics $strip ([System.Drawing.RectangleF]::new(830, 105, 520, 251)) ([System.Drawing.RectangleF]::new(0, 0, 1160, 560)) 12
  Draw-Text $marquee.Graphics 'Open source  |  No analytics  |  No account' 346 387 18 '#c9d1d9'
  Save-Canvas $marquee 'promo-marquee-1400x560.png'

  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'icons\icon-128.png') -Destination (Join-Path $outputDir 'store-icon-128.png') -Force
}
finally {
  $strip.Dispose()
  $popup.Dispose()
  $hover.Dispose()
  $icon.Dispose()
}
