# Use WPF's text shaper to obtain the physical fonts selected for the system UI face.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName PresentationCore,PresentationFramework
$request = ConvertFrom-Json ([Console]::In.ReadToEnd())
function Get-RunFiles($group) {
    foreach ($run in $group.Children) {
        if ($run -is [Windows.Media.GlyphRunDrawing]) { $run.GlyphRun.GlyphTypeface.FontUri.LocalPath }
        elseif ($run -is [Windows.Media.DrawingGroup]) { Get-RunFiles $run }
    }
}
if ($request.monospace) {
    # Windows browsers map the generic monospace family to Consolas.
    $paths = foreach ($weight in @([Windows.FontWeights]::Normal, [Windows.FontWeights]::Bold)) {
        $face = [Windows.Media.Typeface]::new([Windows.Media.FontFamily]::new('Consolas'), [Windows.FontStyles]::Normal, $weight, [Windows.FontStretches]::Normal)
        $physical = $null
        if ($face.TryGetGlyphTypeface([ref]$physical)) { $physical.FontUri.LocalPath }
    }
    ConvertTo-Json -Compress -InputObject @($paths | Select-Object -Unique)
} else {
    $results = [Collections.Generic.List[object]]::new()
    foreach ($group in $request.groups) {
        $text = [string]::Join(' ', [string[]]$group)
        $paths = foreach ($weight in @([Windows.FontWeights]::Normal, [Windows.FontWeights]::SemiBold, [Windows.FontWeights]::Bold)) {
            $face = [Windows.Media.Typeface]::new([Windows.SystemFonts]::MessageFontFamily, [Windows.FontStyles]::Normal, $weight, [Windows.FontStretches]::Normal)
            $physical = $null
            if ($face.TryGetGlyphTypeface([ref]$physical)) { $physical.FontUri.LocalPath }
            $formatted = [Windows.Media.FormattedText]::new($text, [Globalization.CultureInfo]::CurrentCulture, [Windows.FlowDirection]::LeftToRight, $face, 17, [Windows.Media.Brushes]::Black, 1)
            $drawing = [Windows.Media.DrawingGroup]::new()
            $context = $drawing.Open()
            $context.DrawText($formatted, [Windows.Point]::new(0,0))
            $context.Close()
            Get-RunFiles $drawing
        }
        $results.Add(@($paths | Select-Object -Unique))
    }
    ConvertTo-Json -Compress -Depth 3 -InputObject $results
}
