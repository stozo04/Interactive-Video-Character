# Kayley Services Auto-Start Setup
# Drops .vbs launchers into the Windows Startup folder — no admin required.
# Run once: powershell.exe -ExecutionPolicy Bypass -File scripts\setup-autostart.ps1
#
# To remove: delete the .vbs files from:
#   C:\Users\gates\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\

$workDir    = "C:\Users\gates\Personal\Interactive-Video-Character"
$startupDir = [Environment]::GetFolderPath('Startup')
$logDir     = "$workDir\logs\autostart"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$services = @(
  @{ Name = "KayleyServer";   Script = "agent:dev"    },
  @{ Name = "KayleyTidy";     Script = "tidy:dev"     },
  @{ Name = "KayleyOpey";     Script = "opey:dev"     },
  @{ Name = "KayleyTelegram"; Script = "telegram:dev" }
)

foreach ($svc in $services) {
  $logFile = "$logDir\$($svc.Name).log"
  $vbsPath = "$startupDir\$($svc.Name).vbs"

  # VBScript launches cmd hidden (no console window flashing)
  $vbs = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c cd /d ""$workDir"" && npm run $($svc.Script) >> ""$logFile"" 2>&1", 0, False
"@

  Set-Content -Path $vbsPath -Value $vbs -Encoding ASCII
  Write-Host "Created: $vbsPath"
}

Write-Host ""
Write-Host "Done. All 4 services will auto-start silently on next logon."
Write-Host "Logs will be written to: $logDir"
Write-Host ""
Write-Host "To remove auto-start, delete the .vbs files from:"
Write-Host "  $startupDir"
