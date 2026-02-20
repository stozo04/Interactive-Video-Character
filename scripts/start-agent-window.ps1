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
# Skips if already running (checked via a simple title-based guard).

$whatsappCommand = "cd `"$repoRoot`"; npm run whatsapp:dev"

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
