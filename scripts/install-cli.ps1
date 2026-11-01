$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskTools = [IO.Path]::GetFullPath((Join-Path $taskRoot '.tools'))
if (-not $taskTools.StartsWith([IO.Path]::GetFullPath($taskRoot) + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid tool directory.' }
New-Item -ItemType Directory -Path $taskTools -Force | Out-Null
$taskArchive = Join-Path $taskTools 'entire-v0.12.2.zip'
Invoke-WebRequest -Uri 'https://github.com/entireio/cli/releases/download/v0.12.2/entire_windows_amd64.zip' -OutFile $taskArchive
$taskDigest = (Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($taskDigest -ne 'd213ef9dd3329526a01be8ff44d5d2d07fc26dab2755e90618bf8ded692fade6') { throw 'Official CLI checksum verification failed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip = [IO.Compression.ZipFile]::OpenRead($taskArchive)
try {
    $taskEntries = @($taskZip.Entries | Where-Object { $_.Name -eq 'entire.exe' })
    if ($taskEntries.Count -ne 1) { throw 'Expected exactly one entire.exe.' }
    $taskInput = $taskEntries[0].Open()
    $taskOutput = [IO.File]::Create((Join-Path $taskTools 'entire.exe'))
    try { $taskInput.CopyTo($taskOutput) } finally { $taskInput.Dispose(); $taskOutput.Dispose() }
} finally { $taskZip.Dispose() }
Write-Output 'Verified official Entire CLI v0.12.2 in .tools/entire.exe.'
