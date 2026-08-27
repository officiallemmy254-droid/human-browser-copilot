# PowerShell script to register the Human Browser Native Messaging Host in Chrome Registry
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.antigravity.human_browser"
$manifestPath = "C:\Users\SIR\human-browser\host\com.antigravity.human_browser.json"

Write-Host "Registering Native Messaging Host in Windows Registry..." -ForegroundColor Cyan

if (!(Test-Path $registryPath)) {
    New-Item -Path $registryPath -Force | Out-Null
}

Set-ItemProperty -Path $registryPath -Name "(Default)" -Value $manifestPath -Type String

Write-Host "✅ Native Messaging Host successfully registered at:" -ForegroundColor Green
Write-Host "   $registryPath -> $manifestPath" -ForegroundColor White
