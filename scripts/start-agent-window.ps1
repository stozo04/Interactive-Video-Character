$agentPort = 4010

function Test-AgentListening {
  param (
    [int]$Port
  )

  try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -First 1
    return $null -ne $listener
  } catch {
    return $false
  }
}

if (Test-AgentListening -Port $agentPort) {
  Write-Host "[dev] Workspace agent already running on port $agentPort. Skipping launch."
  exit 0
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$agentCommand = "cd `"$repoRoot`"; npm run agent:dev"

try {
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $agentCommand
  ) -ErrorAction Stop | Out-Null

  Write-Host "[dev] Started workspace agent in a new PowerShell window."
} catch {
  Write-Error "[dev] Failed to start workspace agent window: $($_.Exception.Message)"
  exit 1
}

# ── WhatsApp bridge ──────────────────────────────────────────────────
# Launches in its own PowerShell window alongside the agent.
# Skips if already running on port 4011 (health server).
# If the health server is NOT listening but a lock file exists, the old
# process (possibly running without the health server) is killed by PID
# before spawning a fresh bridge so it picks up the latest code.

$whatsappHealthPort = 4011
$whatsappLockFile   = Join-Path $repoRoot ".whatsapp-auth\bridge.lock"
$whatsappCommand    = "cd `"$repoRoot`"; npm run whatsapp:dev"

if (Test-AgentListening -Port $whatsappHealthPort) {
  Write-Host "[dev] WhatsApp bridge already running on port $whatsappHealthPort. Skipping launch."
} else {
  # Health server not listening — kill any stale process holding the lock.
  if (Test-Path $whatsappLockFile) {
    $oldPid = Get-Content $whatsappLockFile -ErrorAction SilentlyContinue
    if ($oldPid -match '^\d+$') {
      try {
        Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
        Write-Host "[dev] Killed stale WhatsApp bridge process (PID $oldPid)."
      } catch { }
    }
    Remove-Item $whatsappLockFile -Force -ErrorAction SilentlyContinue
    Write-Host "[dev] Removed stale lock file."
  }

  try {
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
      "-NoExit",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "`$Host.UI.RawUI.WindowTitle = 'WhatsApp Bridge'; $whatsappCommand"
    ) -ErrorAction Stop | Out-Null

    Write-Host "[dev] Started WhatsApp bridge in a new PowerShell window."
  } catch {
    Write-Error "[dev] Failed to start WhatsApp bridge window: $($_.Exception.Message)"
    # Non-fatal — dev can still work without WhatsApp
  }
}
