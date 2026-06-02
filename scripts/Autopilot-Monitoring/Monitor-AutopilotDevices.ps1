<#
.SYNOPSIS
    Remote monitoring of multiple Autopilot v2 deployments via Microsoft Graph API

.DESCRIPTION
    This script monitors multiple devices deploying via Autopilot v2 from your admin workstation.
    Uses Microsoft Graph API to query device status, much faster than Intune Portal!

    Features:
    - Monitor multiple devices simultaneously
    - Real-time status updates
    - Enrollment progress tracking
    - App installation status
    - Error detection
    - Export reports

.PARAMETER DeviceNames
    Array of device names to monitor (optional, monitors all if not specified)

.PARAMETER GroupTag
    Monitor devices with specific Group Tag

.PARAMETER RefreshInterval
    Seconds between API calls (default: 30, minimum: 10 to avoid throttling)

.PARAMETER ExportReport
    Export monitoring data to JSON

.EXAMPLE
    .\Monitor-AutopilotDevices.ps1

.EXAMPLE
    .\Monitor-AutopilotDevices.ps1 -DeviceNames @("DEVICE001", "DEVICE002")

.EXAMPLE
    .\Monitor-AutopilotDevices.ps1 -GroupTag "Autopilot-Batch-2025"

.EXAMPLE
    .\Monitor-AutopilotDevices.ps1 -RefreshInterval 15 -ExportReport

.NOTES
    Filename: Monitor-AutopilotDevices.ps1
    Author: PowerShell Automation
    Version: 1.0
    Requires: Microsoft.Graph PowerShell module
    Permissions: DeviceManagementManagedDevices.Read.All, DeviceManagementApps.Read.All
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string[]]$DeviceNames,

    [Parameter(Mandatory = $false)]
    [string]$GroupTag,

    [Parameter(Mandatory = $false)]
    [ValidateRange(10, 300)]
    [int]$RefreshInterval = 30,

    [Parameter(Mandatory = $false)]
    [switch]$ExportReport
)

# Check for Microsoft.Graph module
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Write-Host "ERROR: Microsoft.Graph PowerShell module not found!" -ForegroundColor Red
    Write-Host "Install with: Install-Module Microsoft.Graph -Scope CurrentUser" -ForegroundColor Yellow
    exit 1
}

# Import required modules
Import-Module Microsoft.Graph.Authentication
Import-Module Microsoft.Graph.DeviceManagement -ErrorAction SilentlyContinue

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

function Connect-GraphAPI {
    <#
    .SYNOPSIS
        Connects to Microsoft Graph API
    #>

    try {
        Write-Host "Connecting to Microsoft Graph..." -ForegroundColor Cyan

        # Connect with required scopes
        Connect-MgGraph -Scopes "DeviceManagementManagedDevices.Read.All", "DeviceManagementApps.Read.All" -NoWelcome

        Write-Host "Connected successfully!" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "Failed to connect to Microsoft Graph: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

function Get-AutopilotDevices {
    <#
    .SYNOPSIS
        Gets Autopilot devices to monitor
    #>
    param(
        [string[]]$Names,
        [string]$Tag
    )

    try {
        $uri = "https://graph.microsoft.com/beta/deviceManagement/managedDevices"

        # Build filter
        $filters = @()

        if ($Names) {
            $nameFilters = $Names | ForEach-Object { "deviceName eq '$_'" }
            $filters += "(" + ($nameFilters -join " or ") + ")"
        }

        if ($Tag) {
            $filters += "enrollmentProfileName eq '$Tag'"
        }

        # Only active enrollments
        $filters += "managementState eq 'managed'"

        if ($filters.Count -gt 0) {
            $uri += "?`$filter=" + ($filters -join " and ")
        }

        Write-Host "Querying devices..." -ForegroundColor Gray

        $response = Invoke-MgGraphRequest -Uri $uri -Method GET

        if ($response.value) {
            return $response.value
        }

        return @()
    }
    catch {
        Write-Host "Error querying devices: $($_.Exception.Message)" -ForegroundColor Red
        return @()
    }
}

function Get-DeviceAppStatus {
    <#
    .SYNOPSIS
        Gets app installation status for a device
    #>
    param(
        [string]$DeviceId
    )

    try {
        $uri = "https://graph.microsoft.com/beta/deviceManagement/managedDevices/$DeviceId/deviceManagementScripts"

        $response = Invoke-MgGraphRequest -Uri $uri -Method GET -ErrorAction SilentlyContinue

        if ($response.value) {
            return $response.value | ForEach-Object {
                @{
                    Name = $_.displayName
                    Status = $_.runState
                    LastRun = $_.lastStateUpdateDateTime
                }
            }
        }

        return @()
    }
    catch {
        return @()
    }
}

function Show-DeviceDashboard {
    param(
        [array]$Devices
    )

    Clear-Host

    # Header
    Write-ColorOutput "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-ColorOutput "    AUTOPILOT V2 MULTI-DEVICE MONITOR" -ForegroundColor Cyan
    Write-ColorOutput "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""

    Write-ColorOutput "Monitoring: " -ForegroundColor Gray -NoNewline
    Write-ColorOutput "$($Devices.Count) device(s)" -ForegroundColor White

    Write-ColorOutput "Updated: " -ForegroundColor Gray -NoNewline
    Write-ColorOutput "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White

    Write-Host ""
    Write-ColorOutput "───────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host ""

    # Device list
    foreach ($device in $Devices | Sort-Object deviceName) {
        Write-ColorOutput "╔═══ $($device.deviceName) " -ForegroundColor Yellow -NoNewline
        Write-ColorOutput "═══" -ForegroundColor Yellow

        # Enrollment status
        Write-ColorOutput "║ " -ForegroundColor Yellow -NoNewline

        $enrollStatus = switch ($device.enrollmentState) {
            "enrolled" { "Enrolled"; $color = "Green" }
            "pendingReset" { "Pending Reset"; $color = "Yellow" }
            "failed" { "Failed"; $color = "Red" }
            "notContacted" { "Not Contacted"; $color = "Gray" }
            default { $device.enrollmentState; $color = "White" }
        }

        Write-ColorOutput "Status: " -ForegroundColor Gray -NoNewline
        Write-ColorOutput "$enrollStatus" -ForegroundColor $color

        # Compliance
        Write-ColorOutput "║ " -ForegroundColor Yellow -NoNewline

        $complianceStatus = switch ($device.complianceState) {
            "compliant" { "Compliant ✓"; $color = "Green" }
            "noncompliant" { "Non-Compliant ✗"; $color = "Red" }
            "conflict" { "Conflict"; $color = "Yellow" }
            "unknown" { "Unknown"; $color = "Gray" }
            default { $device.complianceState; $color = "White" }
        }

        Write-ColorOutput "Compliance: " -ForegroundColor Gray -NoNewline
        Write-ColorOutput "$complianceStatus" -ForegroundColor $color

        # Last sync
        Write-ColorOutput "║ " -ForegroundColor Yellow -NoNewline

        if ($device.lastSyncDateTime) {
            $lastSync = [DateTime]::Parse($device.lastSyncDateTime)
            $timeSinceSync = (Get-Date) - $lastSync

            $syncColor = if ($timeSinceSync.TotalMinutes -lt 10) { "Green" }
                        elseif ($timeSinceSync.TotalHours -lt 1) { "Yellow" }
                        else { "Red" }

            Write-ColorOutput "Last Sync: " -ForegroundColor Gray -NoNewline
            Write-ColorOutput "$($lastSync.ToString('HH:mm:ss')) " -ForegroundColor $syncColor -NoNewline
            Write-ColorOutput "($([Math]::Round($timeSinceSync.TotalMinutes, 0)) min ago)" -ForegroundColor DarkGray
        }
        else {
            Write-ColorOutput "Last Sync: " -ForegroundColor Gray -NoNewline
            Write-ColorOutput "Never" -ForegroundColor Red
        }

        # Device info
        Write-ColorOutput "║ " -ForegroundColor Yellow -NoNewline
        Write-ColorOutput "OS: " -ForegroundColor Gray -NoNewline
        Write-ColorOutput "$($device.operatingSystem) $($device.osVersion)" -ForegroundColor White -NoNewline
        Write-ColorOutput " | " -ForegroundColor DarkGray -NoNewline
        Write-ColorOutput "User: " -ForegroundColor Gray -NoNewline
        Write-ColorOutput "$(if ($device.userPrincipalName) { $device.userPrincipalName } else { 'None' })" -ForegroundColor White

        # Enrollment profile
        if ($device.enrollmentProfileName) {
            Write-ColorOutput "║ " -ForegroundColor Yellow -NoNewline
            Write-ColorOutput "Profile: " -ForegroundColor Gray -NoNewline
            Write-ColorOutput "$($device.enrollmentProfileName)" -ForegroundColor Cyan
        }

        # Enrollment date
        if ($device.enrolledDateTime) {
            $enrolled = [DateTime]::Parse($device.enrolledDateTime)
            Write-ColorOutput "║ " -ForegroundColor Yellow -NoNewline
            Write-ColorOutput "Enrolled: " -ForegroundColor Gray -NoNewline
            Write-ColorOutput "$($enrolled.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White
        }

        Write-ColorOutput "╚═══════════════════════════════════════════════════════" -ForegroundColor Yellow
        Write-Host ""
    }

    # Summary
    Write-ColorOutput "───────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray

    $enrolled = ($Devices | Where-Object { $_.enrollmentState -eq 'enrolled' }).Count
    $compliant = ($Devices | Where-Object { $_.complianceState -eq 'compliant' }).Count
    $failed = ($Devices | Where-Object { $_.enrollmentState -eq 'failed' }).Count

    Write-ColorOutput "Summary: " -ForegroundColor Gray -NoNewline
    Write-ColorOutput "$enrolled enrolled " -ForegroundColor Green -NoNewline
    Write-ColorOutput "| " -ForegroundColor DarkGray -NoNewline
    Write-ColorOutput "$compliant compliant " -ForegroundColor Green -NoNewline
    Write-ColorOutput "| " -ForegroundColor DarkGray -NoNewline
    if ($failed -gt 0) {
        Write-ColorOutput "$failed failed " -ForegroundColor Red
    }
    else {
        Write-ColorOutput "$failed failed" -ForegroundColor Green
    }

    Write-ColorOutput "───────────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-ColorOutput "Press CTRL+C to stop monitoring | Refresh every $RefreshInterval seconds" -ForegroundColor Gray
    Write-ColorOutput "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
}

# Main execution
Write-Host ""
Write-Host "Autopilot Multi-Device Monitor" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""

# Connect to Graph API
if (-not (Connect-GraphAPI)) {
    exit 1
}

Write-Host ""
Write-Host "Starting monitoring..." -ForegroundColor Green
Start-Sleep -Seconds 2

$monitoringData = @{
    StartTime = Get-Date
    Devices = @()
}

try {
    while ($true) {
        # Get devices
        $devices = Get-AutopilotDevices -Names $DeviceNames -Tag $GroupTag

        if ($devices.Count -eq 0) {
            Write-Host "No devices found matching criteria." -ForegroundColor Yellow
            Write-Host "  - DeviceNames: $($DeviceNames -join ', ')" -ForegroundColor Gray
            Write-Host "  - GroupTag: $GroupTag" -ForegroundColor Gray
            Write-Host ""
            Write-Host "Waiting $RefreshInterval seconds before retry..." -ForegroundColor Gray
        }
        else {
            # Store monitoring data
            $monitoringData.Devices = $devices

            # Display dashboard
            Show-DeviceDashboard -Devices $devices

            # Check if all devices completed
            $allCompleted = $devices | Where-Object {
                $_.enrollmentState -eq 'enrolled' -and
                $_.complianceState -eq 'compliant'
            }

            if ($allCompleted.Count -eq $devices.Count) {
                Write-Host ""
                Write-ColorOutput "═══════════════════════════════════════════════════════════════════" -ForegroundColor Green
                Write-ColorOutput "    ALL DEVICES ENROLLED AND COMPLIANT!" -ForegroundColor Green
                Write-ColorOutput "═══════════════════════════════════════════════════════════════════" -ForegroundColor Green

                if ($ExportReport) {
                    $reportPath = "$env:TEMP\AutopilotMonitorReport_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
                    $monitoringData | ConvertTo-Json -Depth 5 | Out-File $reportPath
                    Write-Host "Report exported to: $reportPath" -ForegroundColor Cyan
                }

                break
            }
        }

        # Wait before next refresh
        Start-Sleep -Seconds $RefreshInterval
    }
}
catch {
    Write-Host ""
    Write-ColorOutput "Monitoring stopped: $($_.Exception.Message)" -ForegroundColor Red

    if ($ExportReport) {
        $reportPath = "$env:TEMP\AutopilotMonitorReport_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
        $monitoringData | ConvertTo-Json -Depth 5 | Out-File $reportPath
        Write-Host "Report exported to: $reportPath" -ForegroundColor Cyan
    }
}
finally {
    Write-Host ""
    Write-Host "Disconnecting from Microsoft Graph..." -ForegroundColor Gray
    Disconnect-MgGraph -ErrorAction SilentlyContinue
    Write-Host "Thank you for using Autopilot Monitor!" -ForegroundColor Cyan
}
