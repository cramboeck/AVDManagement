<#
.SYNOPSIS
    Real-time monitoring of Windows Autopilot v2 deployment on local device

.DESCRIPTION
    This script provides live monitoring of the Autopilot deployment process directly
    on the device being provisioned. It tracks ESP phases, Device Preparation scripts,
    Win32 apps, and provides detailed progress information.

    Much faster than Intune Portal for real-time deployment monitoring!

.PARAMETER RefreshInterval
    Seconds between status updates (default: 5)

.PARAMETER ShowLogs
    Display log entries in real-time

.PARAMETER ExportReport
    Export final report to JSON file

.EXAMPLE
    .\Watch-AutopilotDeployment.ps1

.EXAMPLE
    .\Watch-AutopilotDeployment.ps1 -RefreshInterval 3 -ShowLogs

.EXAMPLE
    .\Watch-AutopilotDeployment.ps1 -ExportReport

.NOTES
    Filename: Watch-AutopilotDeployment.ps1
    Author: PowerShell Automation
    Version: 1.0
    Run as: SYSTEM or Administrator
    Location: Run on device during Autopilot deployment
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [int]$RefreshInterval = 5,

    [Parameter(Mandatory = $false)]
    [switch]$ShowLogs,

    [Parameter(Mandatory = $false)]
    [switch]$ExportReport
)

# Ensure running as Administrator
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    exit 1
}

# Initialize
$Script:StartTime = Get-Date
$Script:DeploymentData = @{
    StartTime = $Script:StartTime
    DeviceName = $env:COMPUTERNAME
    Phases = @()
    Scripts = @()
    Apps = @()
    Errors = @()
}

# Log paths
$LogPaths = @{
    IME = "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs\IntuneManagementExtension.log"
    AgentExecutor = "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs\AgentExecutor.log"
    DevicePrep = "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs\DevicePrep*.log"
    ESP = "$env:ProgramData\Microsoft\Provisioning\Diagnostics\*.log"
}

function Write-ColorOutput {
    param(
        [string]$Message,
        [ConsoleColor]$ForegroundColor = 'White',
        [switch]$NoNewline
    )

    $params = @{
        Object = $Message
        ForegroundColor = $ForegroundColor
    }
    if ($NoNewline) {
        $params.Add('NoNewline', $true)
    }

    Write-Host @params
}

function Get-ESPPhase {
    <#
    .SYNOPSIS
        Gets current Enrollment Status Page (ESP) phase
    #>

    try {
        # Check registry for ESP status
        $ESPStatus = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Enrollments\*\Status' -ErrorAction SilentlyContinue |
            Where-Object { $_.EnrollmentState -ne $null }

        if ($ESPStatus) {
            $phase = switch ($ESPStatus.EnrollmentState) {
                0 { "Not Started" }
                1 { "Device Preparation" }
                2 { "Device Setup" }
                3 { "Account Setup" }
                4 { "Completed" }
                default { "Unknown ($($ESPStatus.EnrollmentState))" }
            }

            return @{
                Phase = $phase
                State = $ESPStatus.EnrollmentState
                Progress = if ($ESPStatus.InstallProgressPercentComplete) { $ESPStatus.InstallProgressPercentComplete } else { 0 }
            }
        }

        return @{
            Phase = "Unknown"
            State = -1
            Progress = 0
        }
    }
    catch {
        return @{
            Phase = "Error"
            State = -1
            Progress = 0
        }
    }
}

function Get-DevicePrepScripts {
    <#
    .SYNOPSIS
        Gets Device Preparation script status
    #>

    $scripts = @()

    try {
        # Parse Device Prep logs
        $devPrepLogs = Get-ChildItem -Path "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs" -Filter "DevicePrep*.log" -ErrorAction SilentlyContinue

        foreach ($log in $devPrepLogs) {
            $content = Get-Content $log.FullName -Tail 100 -ErrorAction SilentlyContinue

            # Look for script execution patterns
            $scriptMatches = $content | Select-String -Pattern 'Script\s+.*\s+(Starting|Completed|Failed)'

            foreach ($match in $scriptMatches) {
                if ($match -match 'Script\s+(.+?)\s+(Starting|Completed|Failed)') {
                    $scripts += @{
                        Name = $Matches[1]
                        Status = $Matches[2]
                        Time = (Get-Date $log.LastWriteTime -Format 'HH:mm:ss')
                    }
                }
            }
        }
    }
    catch {
        # Silent fail
    }

    return $scripts
}

function Get-Win32AppStatus {
    <#
    .SYNOPSIS
        Gets Win32 app installation status
    #>

    $apps = @()

    try {
        # Check IME log for app installations
        if (Test-Path $LogPaths.AgentExecutor) {
            $content = Get-Content $LogPaths.AgentExecutor -Tail 200 -ErrorAction SilentlyContinue

            # Parse app installation entries
            $appMatches = $content | Select-String -Pattern '\[Win32App\].*AppName\s*=\s*([^,]+).*Status\s*=\s*(\w+)'

            foreach ($match in $appMatches) {
                if ($match -match 'AppName\s*=\s*([^,]+).*Status\s*=\s*(\w+)') {
                    $apps += @{
                        Name = $Matches[1].Trim()
                        Status = $Matches[2].Trim()
                        Time = (Get-Date).ToString('HH:mm:ss')
                    }
                }
            }
        }
    }
    catch {
        # Silent fail
    }

    return $apps
}

function Get-RecentErrors {
    <#
    .SYNOPSIS
        Gets recent errors from logs
    #>

    $errors = @()

    try {
        # Check IME log for errors
        if (Test-Path $LogPaths.IME) {
            $content = Get-Content $LogPaths.IME -Tail 500 -ErrorAction SilentlyContinue

            $errorMatches = $content | Select-String -Pattern '\[ERROR\]|\[FATAL\]|Exception|failed|error' -Context 0,1

            foreach ($match in $errorMatches | Select-Object -Last 10) {
                $errors += @{
                    Message = $match.Line
                    Context = if ($match.Context.PostContext) { $match.Context.PostContext[0] } else { "" }
                    Time = (Get-Date).ToString('HH:mm:ss')
                }
            }
        }
    }
    catch {
        # Silent fail
    }

    return $errors
}

function Show-Dashboard {
    param(
        [hashtable]$ESPInfo,
        [array]$Scripts,
        [array]$Apps,
        [array]$Errors
    )

    Clear-Host

    # Header
    Write-ColorOutput "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-ColorOutput "    AUTOPILOT V2 DEPLOYMENT MONITOR - REAL-TIME" -ForegroundColor Cyan
    Write-ColorOutput "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""

    # Device Info
    Write-ColorOutput "Device: " -ForegroundColor Gray -NoNewline
    Write-ColorOutput "$env:COMPUTERNAME" -ForegroundColor White

    Write-ColorOutput "Started: " -ForegroundColor Gray -NoNewline
    Write-ColorOutput "$($Script:StartTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White

    $elapsed = (Get-Date) - $Script:StartTime
    Write-ColorOutput "Elapsed: " -ForegroundColor Gray -NoNewline
    Write-ColorOutput "$($elapsed.Hours)h $($elapsed.Minutes)m $($elapsed.Seconds)s" -ForegroundColor White

    Write-Host ""
    Write-ColorOutput "───────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host ""

    # ESP Phase
    Write-ColorOutput "╔═══ ENROLLMENT STATUS PAGE (ESP) ═══" -ForegroundColor Yellow
    Write-ColorOutput "║" -ForegroundColor Yellow -NoNewline

    $phaseColor = switch ($ESPInfo.Phase) {
        "Completed" { "Green" }
        "Device Preparation" { "Cyan" }
        "Device Setup" { "Cyan" }
        "Account Setup" { "Cyan" }
        "Unknown" { "Red" }
        "Error" { "Red" }
        default { "Yellow" }
    }

    Write-ColorOutput " Current Phase: " -ForegroundColor Gray -NoNewline
    Write-ColorOutput "$($ESPInfo.Phase)" -ForegroundColor $phaseColor

    Write-ColorOutput "║ Progress: " -ForegroundColor Yellow -NoNewline

    # Progress bar
    $progressBarLength = 40
    $filledLength = [Math]::Floor($progressBarLength * ($ESPInfo.Progress / 100))
    $emptyLength = $progressBarLength - $filledLength

    Write-ColorOutput ("[" + ("█" * $filledLength) + ("░" * $emptyLength) + "]") -ForegroundColor Green -NoNewline
    Write-ColorOutput " $($ESPInfo.Progress)%" -ForegroundColor White

    Write-ColorOutput "╚═══════════════════════════════════════════════════════" -ForegroundColor Yellow
    Write-Host ""

    # Device Preparation Scripts
    if ($Scripts.Count -gt 0) {
        Write-ColorOutput "╔═══ DEVICE PREPARATION SCRIPTS ═══" -ForegroundColor Magenta

        foreach ($script in $Scripts | Select-Object -Last 5) {
            Write-ColorOutput "║ " -ForegroundColor Magenta -NoNewline

            $statusIcon = switch ($script.Status) {
                "Completed" { "✓"; $statusColor = "Green" }
                "Starting" { "⟳"; $statusColor = "Yellow" }
                "Failed" { "✗"; $statusColor = "Red" }
                default { "?"; $statusColor = "Gray" }
            }

            Write-ColorOutput "$statusIcon " -ForegroundColor $statusColor -NoNewline
            Write-ColorOutput "$($script.Name) " -ForegroundColor White -NoNewline
            Write-ColorOutput "[$($script.Time)]" -ForegroundColor DarkGray
        }

        Write-ColorOutput "╚═══════════════════════════════════════════════════════" -ForegroundColor Magenta
        Write-Host ""
    }

    # Win32 Apps
    if ($Apps.Count -gt 0) {
        Write-ColorOutput "╔═══ WIN32 APPLICATIONS ═══" -ForegroundColor Blue

        foreach ($app in $Apps | Select-Object -Last 5) {
            Write-ColorOutput "║ " -ForegroundColor Blue -NoNewline

            $statusIcon = switch ($app.Status) {
                "Success" { "✓"; $statusColor = "Green" }
                "Installing" { "⟳"; $statusColor = "Yellow" }
                "Downloading" { "↓"; $statusColor = "Cyan" }
                "Failed" { "✗"; $statusColor = "Red" }
                default { "?"; $statusColor = "Gray" }
            }

            Write-ColorOutput "$statusIcon " -ForegroundColor $statusColor -NoNewline
            Write-ColorOutput "$($app.Name) " -ForegroundColor White -NoNewline
            Write-ColorOutput "[$($app.Time)]" -ForegroundColor DarkGray
        }

        Write-ColorOutput "╚═══════════════════════════════════════════════════════" -ForegroundColor Blue
        Write-Host ""
    }

    # Errors
    if ($Errors.Count -gt 0) {
        Write-ColorOutput "╔═══ ERRORS/WARNINGS ═══" -ForegroundColor Red

        foreach ($error in $Errors | Select-Object -Last 3) {
            Write-ColorOutput "║ " -ForegroundColor Red -NoNewline
            Write-ColorOutput "✗ " -ForegroundColor Red -NoNewline
            Write-ColorOutput "$($error.Message.Substring(0, [Math]::Min(60, $error.Message.Length)))..." -ForegroundColor Yellow
        }

        Write-ColorOutput "╚═══════════════════════════════════════════════════════" -ForegroundColor Red
        Write-Host ""
    }

    # Footer
    Write-ColorOutput "───────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-ColorOutput "Press CTRL+C to stop monitoring | Refresh every $RefreshInterval seconds" -ForegroundColor Gray
    Write-ColorOutput "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
}

# Main monitoring loop
Write-Host "Starting Autopilot Deployment Monitor..." -ForegroundColor Green
Write-Host "Monitoring will begin in 3 seconds..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

try {
    while ($true) {
        # Gather current status
        $espInfo = Get-ESPPhase
        $scripts = Get-DevicePrepScripts
        $apps = Get-Win32AppStatus
        $errors = Get-RecentErrors

        # Update deployment data
        $Script:DeploymentData.Phases += $espInfo
        $Script:DeploymentData.Scripts = $scripts
        $Script:DeploymentData.Apps = $apps
        $Script:DeploymentData.Errors = $errors

        # Display dashboard
        Show-Dashboard -ESPInfo $espInfo -Scripts $scripts -Apps $apps -Errors $errors

        # Check if deployment completed
        if ($espInfo.Phase -eq "Completed" -and $espInfo.Progress -eq 100) {
            Write-Host ""
            Write-ColorOutput "═══════════════════════════════════════════════════════════════════" -ForegroundColor Green
            Write-ColorOutput "    DEPLOYMENT COMPLETED SUCCESSFULLY!" -ForegroundColor Green
            Write-ColorOutput "═══════════════════════════════════════════════════════════════════" -ForegroundColor Green

            $totalTime = (Get-Date) - $Script:StartTime
            Write-Host ""
            Write-ColorOutput "Total deployment time: $($totalTime.Hours)h $($totalTime.Minutes)m $($totalTime.Seconds)s" -ForegroundColor White

            if ($ExportReport) {
                $reportPath = "$env:TEMP\AutopilotDeploymentReport_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
                $Script:DeploymentData | ConvertTo-Json -Depth 5 | Out-File $reportPath
                Write-Host "Report exported to: $reportPath" -ForegroundColor Cyan
            }

            break
        }

        # Wait before next refresh
        Start-Sleep -Seconds $RefreshInterval
    }
}
catch {
    Write-Host ""
    Write-ColorOutput "Monitoring stopped: $($_.Exception.Message)" -ForegroundColor Red

    if ($ExportReport) {
        $reportPath = "$env:TEMP\AutopilotDeploymentReport_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
        $Script:DeploymentData | ConvertTo-Json -Depth 5 | Out-File $reportPath
        Write-Host "Report exported to: $reportPath" -ForegroundColor Cyan
    }
}
finally {
    Write-Host ""
    Write-Host "Thank you for using Autopilot Deployment Monitor!" -ForegroundColor Cyan
}
