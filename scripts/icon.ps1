# Reproducible, locally drawn application icon; no external artwork.
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
[IO.Directory]::CreateDirectory((Join-Path $root 'build')) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $root 'src/renderer/public')) | Out-Null
$frames = @()
foreach ($size in @(16, 32, 48, 64, 128, 256)) {
    $bitmap = [Drawing.Bitmap]::new($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([Drawing.Color]::FromArgb(255, 23, 23, 23))
    $pen = [Drawing.Pen]::new([Drawing.Color]::White, [single]($size * 0.0625))
    $pen.StartCap = [Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
    foreach ($flip in @(0, 1)) {
        $points = @(@(.37,.23), @(.29,.23), @(.29,.41), @(.23,.5), @(.29,.59), @(.29,.77), @(.37,.77))
        for ($i=0; $i -lt ($points.Count - 1); $i++) {
            $x1 = $points[$i][0]; $x2 = $points[$i+1][0]
            if ($flip -eq 1) { $x1 = 1-$x1; $x2 = 1-$x2 }
            $graphics.DrawLine($pen, [single]($x1*$size), [single]($points[$i][1]*$size), [single]($x2*$size), [single]($points[$i+1][1]*$size))
        }
    }
    $stream = [IO.MemoryStream]::new()
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $frames += ,$stream.ToArray()
    if ($size -eq 256) { [IO.File]::WriteAllBytes((Join-Path $root 'src/renderer/public/icon.png'), $stream.ToArray()) }
    $stream.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$icon = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($icon)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]6)
$offset = 6 + 16*6
$sizes = @(16, 32, 48, 64, 128, 0)
for ($i=0; $i -lt 6; $i++) {
    $writer.Write([byte]$sizes[$i]); $writer.Write([byte]$sizes[$i]); $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
    $offset += $frames[$i].Length
}
foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
[IO.File]::WriteAllBytes((Join-Path $root 'build/icon.ico'), $icon.ToArray())
$writer.Dispose(); $icon.Dispose()
