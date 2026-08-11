# Generates OctoLens extension icons (16/32/48/128 px PNGs).
# Brand: dark slate gradient square, blue lens with glass fill and highlight,
# and a small "discovery" sparkle. Renders a 512px master with GDI+ then
# downscales with high-quality bicubic.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-RoundRectPath($x, $y, $w, $h, $r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function New-SparklePath($cx, $cy, $r) {
    # 4-point star: long vertical/horizontal spikes with a pinched waist.
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $w = $r * 0.28
    $pts = @(
        (New-Object System.Drawing.PointF($cx, ($cy - $r))),
        (New-Object System.Drawing.PointF(($cx + $w), ($cy - $w))),
        (New-Object System.Drawing.PointF(($cx + $r), $cy)),
        (New-Object System.Drawing.PointF(($cx + $w), ($cy + $w))),
        (New-Object System.Drawing.PointF($cx, ($cy + $r))),
        (New-Object System.Drawing.PointF(($cx - $w), ($cy + $w))),
        (New-Object System.Drawing.PointF(($cx - $r), $cy)),
        (New-Object System.Drawing.PointF(($cx - $w), ($cy - $w)))
    )
    $p.AddPolygon($pts)
    return $p
}

$master = 512
$bmp = New-Object System.Drawing.Bitmap($master, $master)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Background: dark slate vertical gradient rounded square
$bgPath = New-RoundRectPath 8 8 496 496 112
$bgRect = New-Object System.Drawing.Rectangle(8, 8, 496, 496)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bgRect,
    [System.Drawing.ColorTranslator]::FromHtml('#1c2431'),
    [System.Drawing.ColorTranslator]::FromHtml('#0d1117'),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillPath($bgBrush, $bgPath)

# Subtle inner border highlight
$edgePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(46, 255, 255, 255), 6)
$edgePath = New-RoundRectPath 12 12 488 488 108
$g.DrawPath($edgePen, $edgePath)

# Lens glass: translucent blue fill
$glassBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(66, 88, 166, 255))
$g.FillEllipse($glassBrush, 112, 112, 232, 232)

# Lens ring + handle in GitHub blue
$pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#4493f8'), 52)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawEllipse($pen, 112, 112, 232, 232)
$g.DrawLine($pen, 318, 318, 408, 408)

# Ring highlight: brighter arc top-left for depth
$hlRing = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#79c0ff'), 52)
$hlRing.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$hlRing.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($hlRing, 112, 112, 232, 232, 170, 120)

# Glass highlight arc
$hlPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(210, 255, 255, 255), 20)
$hlPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$hlPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($hlPen, 156, 156, 148, 148, 195, 52)

# Discovery sparkle top-right
$sparkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#79c0ff'))
$spark = New-SparklePath 408 118 44
$g.FillPath($sparkBrush, $spark)
$sparkSmall = New-SparklePath 448 190 20
$g.FillPath($sparkBrush, $sparkSmall)

$g.Dispose()

foreach ($size in 16, 32, 48, 128) {
    $small = New-Object System.Drawing.Bitmap($size, $size)
    $sg = [System.Drawing.Graphics]::FromImage($small)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $sg.DrawImage($bmp, 0, 0, $size, $size)
    $sg.Dispose()
    $file = Join-Path $outDir "icon-$size.png"
    $small.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "Created $file (${size}x${size})"
    $small.Dispose()
}

# 512 master for store listings / social
$masterFile = Join-Path $outDir 'icon-512.png'
$bmp.Save($masterFile, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Created $masterFile (512x512)"
$bmp.Dispose()
Write-Host 'Done.'
