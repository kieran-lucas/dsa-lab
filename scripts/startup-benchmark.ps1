param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [int]$Runs = 3
)
$ErrorActionPreference = 'Stop'
$Executable = (Resolve-Path -LiteralPath $Executable).Path
$benchmarkRoot = Join-Path (Resolve-Path "$PSScriptRoot\..\.qa").Path ('startup-' + [guid]::NewGuid().ToString('N'))
$previousDataDirectory = $env:DSA_LAB_DATA_DIR
try {
  $env:DSA_LAB_DATA_DIR = $benchmarkRoot
  for ($iteration = 1; $iteration -le $Runs; $iteration++) {
    $existingIds = @(Get-Process -Name 'DSA Lab' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $launcher = Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru
    $windowProcess = $null
    while ($watch.Elapsed.TotalSeconds -lt 60) {
      $windowProcess = Get-Process -Name 'DSA Lab' -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -notin $existingIds -and $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq 'DSA Lab' } |
        Select-Object -First 1
      if ($windowProcess) { break }
      Start-Sleep -Milliseconds 25
    }
    if (!$windowProcess) { throw "No application window within 60 seconds: $Executable" }
    $elapsed = [math]::Round($watch.Elapsed.TotalMilliseconds)
    [PSCustomObject]@{ Run = $iteration; WindowMs = $elapsed; Executable = $Executable } | ConvertTo-Json -Compress
    Start-Sleep -Milliseconds 500
    $null = $windowProcess.CloseMainWindow()
    if (!$windowProcess.WaitForExit(15000)) { throw 'Application did not close normally' }
    if (!$launcher.WaitForExit(15000)) { throw 'Launcher did not close normally' }
  }
} finally {
  $env:DSA_LAB_DATA_DIR = $previousDataDirectory
}
