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

# ── Telegram bridge ──────────────────────────────────────────────────
# Launches in its own PowerShell window alongside the agent.
# Skips if already running on port 4012 (health server).

$telegramHealthPort = 4012
$telegramCommand    = "cd `"$repoRoot`"; npm run telegram:dev"

if (Test-AgentListening -Port $telegramHealthPort) {
  Write-Host "[dev] Telegram bridge already running on port $telegramHealthPort. Skipping launch."
} else {
  try {
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
      "-NoExit",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "`$Host.UI.RawUI.WindowTitle = 'Telegram Bridge'; $telegramCommand"
    ) -ErrorAction Stop | Out-Null

    Write-Host "[dev] Started Telegram bridge in a new PowerShell window."
  } catch {
    Write-Error "[dev] Failed to start Telegram bridge window: $($_.Exception.Message)"
    # Non-fatal — dev can still work without Telegram
  }
}

# ── Opey-Dev agent ──────────────────────────────────────────────────
# Standalone process — no port to check. Supabase ticket locking prevents
# double-processing, so launching unconditionally is safe.

$opeyCommand = "cd `"$repoRoot`"; npm run opey:dev"

try {
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "`$Host.UI.RawUI.WindowTitle = 'Opey Dev'; $opeyCommand"
  ) -ErrorAction Stop | Out-Null

  Write-Host "[dev] Started Opey-Dev agent in a new PowerShell window."
} catch {
  Write-Error "[dev] Failed to start Opey-Dev window: $($_.Exception.Message)"
  # Non-fatal
}

# ── Tidy agent ──────────────────────────────────────────────────────
# Standalone process — polls cron_jobs for code_cleaner and branch cleanup.

$tidyCommand = "cd `"$repoRoot`"; npm run tidy:dev"

try {
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "`$Host.UI.RawUI.WindowTitle = 'Tidy Agent'; $tidyCommand"
  ) -ErrorAction Stop | Out-Null

  Write-Host "[dev] Started Tidy agent in a new PowerShell window."
} catch {
  Write-Error "[dev] Failed to start Tidy window: $($_.Exception.Message)"
  # Non-fatal
}
