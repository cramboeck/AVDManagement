<#
.SYNOPSIS
    Quick Autopilot deployment status check

.DESCRIPTION
    Lightweight script for quick status check of Autopilot deployment on local device.
    Shows current phase, installed apps, scripts status, and recent errors.

.PARAMETER Detailed
    Show detailed information including logs

.PARAMETER ExportHTML
    Export status report to HTML file

.EXAMPLE
    .\Get-AutopilotStatus.ps1

.EXAMPLE
    .\Get-AutopilotStatus.ps1 -Detailed

.EXAMPLE
    .\Get-AutopilotStatus.ps1 -ExportHTML

.NOTES
    Filename: Get-AutopilotStatus.ps1
    Author: PowerShell Automation
    Version: 1.0
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [switch]$Detailed,

    [Parameter(Mandatory = $false)]
    [switch]$ExportHTML
)

function Get-EnrollmentStatus {
    try {
        $status = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Enrollments\*\Status' -ErrorAction SilentlyContinue |
            Where-Object { $_.EnrollmentState -ne $null } |
            Select-Object -First 1

        return @{
            State = $status.EnrollmentState
            Phase = switch ($status.EnrollmentState) {
                0 { "Not Started" }
                1 { "Device Preparation" }
                2 { "Device Setup" }
                3 { "Account Setup" }
                4 { "Completed" }
                default { "Unknown" }
            }
            Progress = if ($status.InstallProgressPercentComplete) { $status.InstallProgressPercentComplete } else { 0 }
            EnrolledDateTime = $status.EnrolledDateTime
        }
    }
    catch {
        return @{
            State = -1
            Phase = "Unknown"
            Progress = 0
        }
    }
}

function Get-InstalledApps {
    $apps = @()

    # Check Win32 apps via registry
    $win32Apps = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\IntuneManagementExtension\Win32Apps\*\*' -ErrorAction SilentlyContinue

    foreach ($app in $win32Apps) {
        if ($app.DisplayName) {
            $apps += [PSCustomObject]@{
                Name = $app.DisplayName
                Version = $app.DisplayVersion
                InstallState = $app.InstallState
            }
        }
    }

    return $apps
}

function Get-ExecutedScripts {
    $scripts = @()

    $logFiles = Get-ChildItem "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs" -Filter "*AutopilotSoftware*.log" -ErrorAction SilentlyContinue

    foreach ($log in $logFiles) {
        $scripts += [PSCustomObject]@{
            Name = $log.Name
            LastModified = $log.LastWriteTime
            SizeKB = [Math]::Round($log.Length / 1KB, 2)
        }
    }

    return $scripts
}

# Main
Clear-Host

Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "    AUTOPILOT DEPLOYMENT STATUS" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Device Info
Write-Host "Device Information:" -ForegroundColor Yellow
Write-Host "  Computer Name: $env:COMPUTERNAME" -ForegroundColor White
Write-Host "  User: $env:USERNAME" -ForegroundColor White
Write-Host "  Date/Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White
Write-Host ""

# Enrollment Status
$enrollment = Get-EnrollmentStatus

Write-Host "Enrollment Status:" -ForegroundColor Yellow

$phaseColor = if ($enrollment.Phase -eq "Completed") { "Green" } else { "Cyan" }
Write-Host "  Phase: " -ForegroundColor Gray -NoNewline
Write-Host "$($enrollment.Phase)" -ForegroundColor $phaseColor

Write-Host "  Progress: " -ForegroundColor Gray -NoNewline
Write-Host "$($enrollment.Progress)%" -ForegroundColor White

if ($enrollment.EnrolledDateTime) {
    Write-Host "  Enrolled: " -ForegroundColor Gray -NoNewline
    Write-Host "$($enrollment.EnrolledDateTime)" -ForegroundColor White
}

Write-Host ""

# Installed Apps
$apps = Get-InstalledApps

if ($apps.Count -gt 0) {
    Write-Host "Installed Applications: ($($apps.Count))" -ForegroundColor Yellow

    foreach ($app in $apps | Select-Object -First 10) {
        $stateColor = switch ($app.InstallState) {
            3 { "Green" }  # Installed
            2 { "Yellow" }  # Installing
            default { "Gray" }
        }

        Write-Host "  ✓ " -ForegroundColor $stateColor -NoNewline
        Write-Host "$($app.Name) " -ForegroundColor White -NoNewline
        Write-Host "v$($app.Version)" -ForegroundColor Gray
    }

    Write-Host ""
}

# Executed Scripts
$scripts = Get-ExecutedScripts

if ($scripts.Count -gt 0) {
    Write-Host "Executed Scripts: ($($scripts.Count))" -ForegroundColor Yellow

    foreach ($script in $scripts) {
        Write-Host "  • $($script.Name) " -ForegroundColor White -NoNewline
        Write-Host "[$($script.LastModified.ToString('HH:mm:ss'))]" -ForegroundColor Gray
    }

    Write-Host ""
}

# Detailed info
if ($Detailed) {
    Write-Host "Detailed Information:" -ForegroundColor Yellow

    # Check .NET Framework
    $dotnet48 = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
    if ($dotnet48.Release -ge 528040) {
        Write-Host "  ✓ .NET Framework 4.8+ installed" -ForegroundColor Green
    }
    else {
        Write-Host "  ✗ .NET Framework 4.8 not found" -ForegroundColor Red
    }

    # Check Firewall
    $firewallProfiles = Get-NetFirewallProfile
    $allEnabled = ($firewallProfiles | Where-Object { $_.Enabled -eq $false }).Count -eq 0

    if ($allEnabled) {
        Write-Host "  ✓ Windows Firewall enabled (all profiles)" -ForegroundColor Green
    }
    else {
        Write-Host "  ⚠ Windows Firewall not fully enabled" -ForegroundColor Yellow
    }

    # Check Defender
    $defender = Get-MpPreference -ErrorAction SilentlyContinue
    if ($defender -and -not $defender.DisableRealtimeMonitoring) {
        Write-Host "  ✓ Windows Defender Real-Time Protection enabled" -ForegroundColor Green
    }
    else {
        Write-Host "  ⚠ Windows Defender Real-Time Protection disabled" -ForegroundColor Yellow
    }

    Write-Host ""
}

# Log locations
Write-Host "Log File Locations:" -ForegroundColor Yellow
Write-Host "  IME: C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\" -ForegroundColor Gray
Write-Host "  Scripts: C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\*Autopilot*.log" -ForegroundColor Gray
Write-Host ""

Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

# Export HTML
if ($ExportHTML) {
    $htmlPath = "$env:TEMP\AutopilotStatus_$(Get-Date -Format 'yyyyMMdd_HHmmss').html"

    $html = @"
<!DOCTYPE html>
<html>
<head>
    <title>Autopilot Status Report</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #0078D4; border-bottom: 3px solid #0078D4; padding-bottom: 10px; }
        h2 { color: #333; margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #0078D4; color: white; }
        .status-completed { color: #107C10; font-weight: bold; }
        .status-inprogress { color: #FF8C00; font-weight: bold; }
        .info-box { background: #E8F4FD; border-left: 4px solid #0078D4; padding: 15px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Autopilot Deployment Status Report</h1>
        <div class="info-box">
            <strong>Device:</strong> $env:COMPUTERNAME<br>
            <strong>User:</strong> $env:USERNAME<br>
            <strong>Generated:</strong> $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        </div>

        <h2>Enrollment Status</h2>
        <table>
            <tr>
                <th>Property</th>
                <th>Value</th>
            </tr>
            <tr>
                <td>Phase</td>
                <td class="$(if ($enrollment.Phase -eq 'Completed') { 'status-completed' } else { 'status-inprogress' })">$($enrollment.Phase)</td>
            </tr>
            <tr>
                <td>Progress</td>
                <td>$($enrollment.Progress)%</td>
            </tr>
        </table>

        <h2>Installed Applications</h2>
        <table>
            <tr>
                <th>Application Name</th>
                <th>Version</th>
                <th>State</th>
            </tr>
            $(foreach ($app in $apps) {
                "<tr><td>$($app.Name)</td><td>$($app.Version)</td><td>$($app.InstallState)</td></tr>"
            })
        </table>

        <div class="footer">
            Report generated by Autopilot Monitoring Tool
        </div>
    </div>
</body>
</html>
"@

    $html | Out-File $htmlPath -Encoding UTF8
    Write-Host "HTML report exported to: $htmlPath" -ForegroundColor Green

    # Open in browser
    Start-Process $htmlPath
}
