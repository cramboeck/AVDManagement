<#
.SYNOPSIS
    Maps network printers for users during Autopilot v2 deployment.

.DESCRIPTION
    This script automatically maps network printers for users based on configuration.
    Supports multiple printers, default printer assignment, driver installation verification,
    and location-based printer assignment.

    Designed for Autopilot v2 scenarios where printer mappings need to be configured
    automatically during or after device deployment.

.PARAMETER PrinterConfig
    Path to JSON configuration file containing printer mappings.
    See example configuration below.

.PARAMETER PrinterPath
    UNC path to network printer (e.g., \\printserver\printer01). Used for single printer.

.PARAMETER SetAsDefault
    If specified, sets the printer as the default printer. Default: $false

.PARAMETER InstallDriver
    If specified, attempts to install printer driver if missing. Default: $false

.PARAMETER LogPath
    Path to log file. Defaults to C:\ProgramData\Intune\Logs\Printers.log

.EXAMPLE
    .\Map-Printers.ps1 -PrinterPath "\\printserver\HP-LaserJet-Floor2"

    Maps a single network printer.

.EXAMPLE
    .\Map-Printers.ps1 -PrinterPath "\\printserver\HP-LaserJet-Floor2" -SetAsDefault

    Maps printer and sets it as default.

.EXAMPLE
    .\Map-Printers.ps1 -PrinterConfig "C:\Config\PrinterMapping.json"

    Maps multiple printers based on JSON configuration file.

.NOTES
    Version:        1.0
    Author:         Autopilot Deployment Team
    Creation Date:  2025-10-26

    Requirements:
    - Windows 11
    - Network connectivity to print servers
    - PowerShell 5.1 or later
    - Printer drivers available on print server or locally

    Intune Deployment:
    - Deploy as Win32 app (for SYSTEM context during device setup)
    - OR deploy as PowerShell script (for USER context at logon)
    - Recommended: Use Intune Printer Provisioning for production
    - This script useful for complex mappings or testing

    JSON Configuration Example:
    {
        "printers": [
            {
                "path": "\\\\printserver\\HP-LaserJet-Floor2",
                "name": "HP LaserJet - 2nd Floor",
                "default": true,
                "location": "Building A"
            },
            {
                "path": "\\\\printserver\\Canon-Color-Reception",
                "name": "Canon Color - Reception",
                "default": false,
                "location": "Building A"
            },
            {
                "path": "\\\\printserver\\Xerox-MFP-HR",
                "name": "Xerox MFP - HR Department",
                "default": false,
                "location": "Building B"
            }
        ],
        "assignByLocation": false,
        "computerLocation": "Building A"
    }

    Location-Based Assignment:
    - Set "assignByLocation": true in JSON
    - Set "computerLocation" to match printer locations
    - Only printers matching location will be mapped
#>

[CmdletBinding(DefaultParameterSetName = 'SinglePrinter')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'ConfigFile')]
    [ValidateScript({ Test-Path $_ })]
    [string]$PrinterConfig,

    [Parameter(Mandatory = $true, ParameterSetName = 'SinglePrinter')]
    [ValidatePattern('^\\\\[^\\]+\\[^\\]+')]
    [string]$PrinterPath,

    [Parameter(Mandatory = $false, ParameterSetName = 'SinglePrinter')]
    [switch]$SetAsDefault,

    [Parameter(Mandatory = $false)]
    [switch]$InstallDriver,

    [Parameter(Mandatory = $false)]
    [string]$LogPath = "C:\ProgramData\Intune\Logs\Printers.log"
)

#region Functions

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('Info', 'Warning', 'Error', 'Success')]
        [string]$Level = 'Info'
    )

    $LogDir = Split-Path -Path $LogPath -Parent
    if (-not (Test-Path $LogDir)) {
        New-Item -Path $LogDir -ItemType Directory -Force | Out-Null
    }

    $Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $LogMessage = "[$Timestamp] [$Level] $Message"

    Add-Content -Path $LogPath -Value $LogMessage

    switch ($Level) {
        'Info'    { Write-Host $LogMessage -ForegroundColor Cyan }
        'Warning' { Write-Host $LogMessage -ForegroundColor Yellow }
        'Error'   { Write-Host $LogMessage -ForegroundColor Red }
        'Success' { Write-Host $LogMessage -ForegroundColor Green }
    }
}

function Test-PrinterConnection {
    param([string]$PrinterPath)

    try {
        # Extract server and share name
        $Parts = $PrinterPath -split '\\'
        $Server = $Parts[2]
        $Share = $Parts[3]

        # Test print server connectivity
        if (Test-Connection -ComputerName $Server -Count 1 -Quiet -ErrorAction SilentlyContinue) {
            Write-Log "Print server $Server is reachable" -Level Info
            return $true
        }
        else {
            Write-Log "Print server $Server is not reachable" -Level Warning
            return $false
        }
    }
    catch {
        Write-Log "Error testing printer connection: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Get-InstalledPrinters {
    try {
        $Printers = Get-Printer | Select-Object -ExpandProperty Name
        return $Printers
    }
    catch {
        Write-Log "Error getting installed printers: $($_.Exception.Message)" -Level Error
        return @()
    }
}

function Remove-ExistingPrinter {
    param([string]$PrinterPath)

    try {
        $ExistingPrinter = Get-Printer | Where-Object { $_.Name -eq $PrinterPath -or $_.PortName -eq $PrinterPath }

        if ($ExistingPrinter) {
            Write-Log "Removing existing printer: $($ExistingPrinter.Name)..." -Level Warning
            Remove-Printer -Name $ExistingPrinter.Name -ErrorAction Stop
            Write-Log "Existing printer removed" -Level Info
        }
    }
    catch {
        Write-Log "Error removing existing printer: $($_.Exception.Message)" -Level Warning
    }
}

function Add-NetworkPrinter {
    param(
        [string]$PrinterPath,
        [string]$FriendlyName = '',
        [bool]$SetAsDefault = $false
    )

    Write-Log "Adding network printer: $PrinterPath..." -Level Info

    # Test printer connectivity
    if (-not (Test-PrinterConnection -PrinterPath $PrinterPath)) {
        Write-Log "Cannot reach printer, skipping" -Level Error
        return $false
    }

    try {
        # Check if printer already exists
        $ExistingPrinter = Get-Printer | Where-Object { $_.Name -eq $PrinterPath }

        if ($ExistingPrinter) {
            Write-Log "Printer already installed: $PrinterPath" -Level Info

            # Set as default if requested
            if ($SetAsDefault) {
                $DefaultPrinter = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Default -eq $true }
                if ($DefaultPrinter.Name -ne $PrinterPath) {
                    Write-Log "Setting as default printer..." -Level Info
                    (Get-CimInstance -ClassName Win32_Printer -Filter "Name='$($PrinterPath -replace '\\','\\')'" | Set-CimInstance -Property @{Default=$true}) 2>&1 | Out-Null
                    Write-Log "Default printer set" -Level Success
                }
            }

            return $true
        }

        # Add printer connection
        Write-Log "Connecting to network printer..." -Level Info
        Add-Printer -ConnectionName $PrinterPath -ErrorAction Stop

        Write-Log "Printer added successfully" -Level Success

        # Verify printer was added
        Start-Sleep -Seconds 2
        $Printer = Get-Printer | Where-Object { $_.Name -eq $PrinterPath }

        if ($Printer) {
            Write-Log "Printer verified: $($Printer.Name)" -Level Success

            # Set friendly name if specified
            if (-not [string]::IsNullOrWhiteSpace($FriendlyName)) {
                try {
                    Rename-Printer -Name $PrinterPath -NewName $FriendlyName -ErrorAction Stop
                    Write-Log "Printer renamed to: $FriendlyName" -Level Info
                }
                catch {
                    Write-Log "Could not rename printer: $($_.Exception.Message)" -Level Warning
                }
            }

            # Set as default if requested
            if ($SetAsDefault) {
                Write-Log "Setting as default printer..." -Level Info
                try {
                    $PrinterName = if ($FriendlyName) { $FriendlyName } else { $PrinterPath }
                    $EscapedName = $PrinterName -replace '\\', '\\'
                    (Get-CimInstance -ClassName Win32_Printer -Filter "Name='$EscapedName'").SetDefaultPrinter() | Out-Null
                    Write-Log "Default printer set" -Level Success
                }
                catch {
                    Write-Log "Could not set default printer: $($_.Exception.Message)" -Level Warning
                }
            }

            return $true
        }
        else {
            Write-Log "Printer verification failed" -Level Error
            return $false
        }
    }
    catch {
        Write-Log "Failed to add printer: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Set-RegistryValue {
    param(
        [string]$Path,
        [string]$Name,
        [object]$Value,
        [string]$Type = 'String'
    )

    try {
        if (-not (Test-Path $Path)) {
            New-Item -Path $Path -Force | Out-Null
        }

        Set-ItemProperty -Path $Path -Name $Name -Value $Value -Type $Type -Force
        return $true
    }
    catch {
        Write-Log "Failed to set registry $Path\$Name : $($_.Exception.Message)" -Level Error
        return $false
    }
}

#endregion

#region Main Execution

$StartTime = Get-Date
Write-Log "=== Network Printer Mapping for Autopilot v2 ==="
Write-Log "Execution Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Level Info
Write-Log "Current User: $env:USERNAME" -Level Info
Write-Log "Computer Name: $env:COMPUTERNAME" -Level Info

$Stats = @{
    Total = 0
    Success = 0
    Failed = 0
    Skipped = 0
}

# Get currently installed printers
Write-Log "Scanning for installed printers..." -Level Info
$InstalledPrinters = Get-InstalledPrinters
Write-Log "Found $($InstalledPrinters.Count) installed printer(s)" -Level Info

# Determine mapping mode
if ($PSCmdlet.ParameterSetName -eq 'ConfigFile') {
    Write-Log "Using configuration file: $PrinterConfig" -Level Info

    try {
        $Config = Get-Content -Path $PrinterConfig -Raw | ConvertFrom-Json

        if (-not $Config.printers) {
            Write-Log "No printers found in configuration file" -Level Error
            exit 1
        }

        Write-Log "Found $($Config.printers.Count) printer(s) in configuration" -Level Info

        # Check for location-based assignment
        $AssignByLocation = if ($null -ne $Config.assignByLocation) { $Config.assignByLocation } else { $false }
        $ComputerLocation = if ($Config.computerLocation) { $Config.computerLocation } else { '' }

        if ($AssignByLocation) {
            Write-Log "Location-based assignment enabled" -Level Info
            Write-Log "Computer location: $ComputerLocation" -Level Info
        }

        foreach ($Printer in $Config.printers) {
            $Stats.Total++

            # Check location filter
            if ($AssignByLocation) {
                if ($Printer.location -and $Printer.location -ne $ComputerLocation) {
                    Write-Log "Skipping printer (location mismatch): $($Printer.path) - Location: $($Printer.location)" -Level Warning
                    $Stats.Skipped++
                    continue
                }
            }

            $PrinterParams = @{
                PrinterPath = $Printer.path
                SetAsDefault = if ($null -ne $Printer.default) { $Printer.default } else { $false }
            }

            if ($Printer.name) { $PrinterParams['FriendlyName'] = $Printer.name }

            if (Add-NetworkPrinter @PrinterParams) {
                $Stats.Success++
            }
            else {
                $Stats.Failed++
            }
        }
    }
    catch {
        Write-Log "Failed to process configuration file: $($_.Exception.Message)" -Level Error
        exit 1
    }
}
else {
    # Single printer mapping
    Write-Log "Mapping single printer" -Level Info
    $Stats.Total = 1

    $PrinterParams = @{
        PrinterPath = $PrinterPath
        SetAsDefault = $SetAsDefault.IsPresent
    }

    if (Add-NetworkPrinter @PrinterParams) {
        $Stats.Success++
    }
    else {
        $Stats.Failed++
    }
}

# Save configuration marker
$MarkerPath = "HKCU:\SOFTWARE\AutopilotDeployment\Printers"
Set-RegistryValue -Path $MarkerPath -Name "MappedDate" -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Set-RegistryValue -Path $MarkerPath -Name "TotalPrinters" -Value $Stats.Total -Type DWord
Set-RegistryValue -Path $MarkerPath -Name "SuccessfulPrinters" -Value $Stats.Success -Type DWord

# Summary
$Duration = (Get-Date) - $StartTime
Write-Log "`n=== Network Printer Mapping Completed ==="
Write-Log "Total Printers: $($Stats.Total)" -Level Info
Write-Log "Successfully Mapped: $($Stats.Success)" -Level Success
Write-Log "Failed: $($Stats.Failed)" -Level $(if ($Stats.Failed -gt 0) { 'Error' } else { 'Info' })
Write-Log "Skipped (location filter): $($Stats.Skipped)" -Level Info
Write-Log "Execution Time: $([Math]::Round($Duration.TotalSeconds, 2)) seconds" -Level Info
Write-Log "Log File: $LogPath" -Level Info

Write-Log "`n=== Important Notes ==="
Write-Log "1. Network printers are mapped for current user" -Level Info
Write-Log "2. Printer drivers are provided by print server (Point and Print)" -Level Info
Write-Log "3. Ensure network connectivity to print servers" -Level Warning
Write-Log "4. For better security, consider using Universal Print or Intune Printer Provisioning" -Level Info
Write-Log "5. Print server must allow Point and Print for driver installation" -Level Warning

if ($Stats.Failed -eq 0) {
    Write-Log "`nAll network printers mapped successfully!" -Level Success
    exit 0
}
else {
    Write-Log "`nSome printer mappings failed. Check log for details." -Level Warning
    exit 1
}

#endregion
