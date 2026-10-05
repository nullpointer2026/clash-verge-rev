$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
Invoke-Checked -Program rustup -Arguments @('target', 'add', 'x86_64-pc-windows-msvc')
Invoke-Checked -Program pnpm -Arguments @('install', '--frozen-lockfile')
Invoke-Checked -Program pnpm -Arguments @('prebuild', 'x86_64-pc-windows-msvc')
$config = Join-Path $PSScriptRoot 'node-delete-build.json'
[System.IO.File]::WriteAllText($config, '{"bundle":{"createUpdaterArtifacts":false}}', [System.Text.UTF8Encoding]::new($false))
try {
    Invoke-Checked -Program pnpm -Arguments @('exec', 'tauri', 'build', '--target', 'x86_64-pc-windows-msvc', '--config', $config, '--ci', '--no-sign')
} finally {
    Remove-Item $config -ErrorAction SilentlyContinue
}
Write-Host 'Installer: target\x86_64-pc-windows-msvc\release\bundle\nsis'
