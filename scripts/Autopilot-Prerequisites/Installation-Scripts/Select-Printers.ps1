<#
.SYNOPSIS
    Interactive printer selection and mapping tool for Windows.

.DESCRIPTION
    This script queries a print server for available printers and presents them
    to the user in an interactive GUI. Users can select which printers they want
    to install and optionally set a default printer.

    Features:
    - Automatic print server discovery
    - Interactive GUI selection (Out-GridView)
    - Console fallback for environments without GUI
    - Multi-printer selection
    - Default printer configuration
    - Printer information display (location, driver, status)
    - Logging

    Perfect for user self-service printer installation scenarios.

.PARAMETER PrintServer
    Name or IP address of the print server to query.
    Example: "printserver.domain.com" or "\\printserver"

.PARAMETER UseGUI
    If specified, uses Out-GridView for graphical selection.
    If not available or $false, uses console menu.
    Default: $true (auto-detect)

.PARAMETER LogPath
    Path to log file. Defaults to C:\ProgramData\Intune\Logs\PrinterSelection.log

.EXAMPLE
    .\Select-Printers.ps1 -PrintServer "printserver01"

    Queries printserver01 and shows interactive printer selection.

.EXAMPLE
    .\Select-Printers.ps1 -PrintServer "\\printserver.domain.com" -UseGUI:$false

    Uses console menu for printer selection instead of GUI.

.NOTES
    Version:        1.0
    Author:         Autopilot Deployment Team
    Creation Date:  2025-10-26

    Requirements:
    - Windows 10/11
    - Network connectivity to print server
    - PowerShell 5.1 or later
    - User context (not SYSTEM)

    Deployment:
    - Run in USER context (not SYSTEM)
    - Can be deployed via Intune as User script
    - Or as desktop shortcut for self-service

    Features:
    - Displays printer name, location, driver, status
    - Multi-select with Ctrl+Click
    - Search/filter functionality in GUI
    - Sets default printer option
    - Connection test before installation
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Print server name or IP (e.g., printserver01)")]
    [string]$PrintServer,

    [Parameter(Mandatory = $false)]
    [bool]$UseGUI = $true,

    [Parameter(Mandatory = $false)]
    [string]$LogPath = "C:\ProgramData\Intune\Logs\PrinterSelection.log"
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

function Test-PrintServerConnection {
    param([string]$ServerName)

    Write-Log "Testing connection to print server: $ServerName..." -Level Info

    # Clean server name (remove \\)
    $CleanServerName = $ServerName -replace '^\\\\', ''

    try {
        # Test network connectivity
        $pingTest = Test-Connection -ComputerName $CleanServerName -Count 1 -Quiet -ErrorAction SilentlyContinue

        if ($pingTest) {
            Write-Log "Print server is reachable" -Level Success
            return $true
        }
        else {
            Write-Log "Print server is not reachable via ping" -Level Warning
            # Try anyway, some servers block ICMP
            return $true
        }
    }
    catch {
        Write-Log "Connection test warning: $($_.Exception.Message)" -Level Warning
        return $true  # Continue anyway
    }
}

function Get-PrintServerPrinters {
    param([string]$ServerName)

    Write-Log "Querying printers from print server..." -Level Info

    # Ensure server name has \\ prefix
    if (-not $ServerName.StartsWith('\\')) {
        $ServerName = "\\$ServerName"
    }

    try {
        # Get all printers from print server
        $Printers = Get-Printer -ComputerName $ServerName.TrimStart('\') -ErrorAction Stop |
                    Where-Object { $_.Shared -eq $true } |
                    Select-Object @{
                        Name='PrinterName'; Expression={$_.Name}
                    }, @{
                        Name='ShareName'; Expression={$_.ShareName}
                    }, @{
                        Name='Location'; Expression={if($_.Location){$_.Location}else{"Not specified"}}
                    }, @{
                        Name='DriverName'; Expression={$_.DriverName}
                    }, @{
                        Name='PrinterStatus'; Expression={$_.PrinterStatus}
                    }, @{
                        Name='UNCPath'; Expression={"$ServerName\$($_.ShareName)"}
                    }

        if ($Printers) {
            Write-Log "Found $($Printers.Count) shared printer(s)" -Level Success
            return $Printers
        }
        else {
            Write-Log "No shared printers found on server" -Level Warning
            return @()
        }
    }
    catch {
        Write-Log "Failed to query print server: $($_.Exception.Message)" -Level Error
        throw
    }
}

function Show-PrinterSelectionGUI {
    param([array]$Printers)

    Write-Log "Showing printer selection GUI..." -Level Info

    try {
        $Selected = $Printers |
            Select-Object PrinterName, Location, DriverName, PrinterStatus, UNCPath |
            Out-GridView -Title "Select Printers to Install (Ctrl+Click for multiple)" -OutputMode Multiple

        if ($Selected) {
            Write-Log "User selected $($Selected.Count) printer(s)" -Level Success
            return $Selected
        }
        else {
            Write-Log "No printers selected" -Level Warning
            return @()
        }
    }
    catch {
        Write-Log "GUI selection failed: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function Show-PrinterSelectionConsole {
    param([array]$Printers)

    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Available Printers on $PrintServer" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan

    # Display printers with numbers
    for ($i = 0; $i -lt $Printers.Count; $i++) {
        $Printer = $Printers[$i]
        Write-Host "[$($i + 1)] " -ForegroundColor Yellow -NoNewline
        Write-Host "$($Printer.PrinterName)" -ForegroundColor White
        Write-Host "    Location: $($Printer.Location)" -ForegroundColor Gray
        Write-Host "    Driver: $($Printer.DriverName)" -ForegroundColor Gray
        Write-Host "    Path: $($Printer.UNCPath)" -ForegroundColor Gray
        Write-Host ""
    }

    Write-Host "Select printers (e.g., '1,3,5' or '1-3' or 'all'): " -ForegroundColor Green -NoNewline
    $Selection = Read-Host

    # Parse selection
    $SelectedIndices = @()

    if ($Selection -eq 'all') {
        $SelectedIndices = 0..($Printers.Count - 1)
    }
    elseif ($Selection -match '^\d+(-\d+)?$') {
        # Range (e.g., 1-3)
        if ($Selection -match '-') {
            $Range = $Selection -split '-'
            $Start = [int]$Range[0] - 1
            $End = [int]$Range[1] - 1
            $SelectedIndices = $Start..$End
        }
        else {
            # Single number
            $SelectedIndices = @([int]$Selection - 1)
        }
    }
    elseif ($Selection -match '^[\d,\s]+$') {
        # Comma-separated (e.g., 1,3,5)
        $Numbers = $Selection -split ',' | ForEach-Object { $_.Trim() }
        $SelectedIndices = $Numbers | ForEach-Object { [int]$_ - 1 }
    }
    else {
        Write-Log "Invalid selection format" -Level Error
        return @()
    }

    # Validate indices
    $SelectedIndices = $SelectedIndices | Where-Object { $_ -ge 0 -and $_ -lt $Printers.Count }

    if ($SelectedIndices.Count -eq 0) {
        Write-Log "No valid printers selected" -Level Warning
        return @()
    }

    $Selected = $SelectedIndices | ForEach-Object { $Printers[$_] }
    Write-Log "User selected $($Selected.Count) printer(s)" -Level Success

    return $Selected
}

function Install-SelectedPrinters {
    param([array]$Printers)

    $Stats = @{
        Total = $Printers.Count
        Success = 0
        Failed = 0
    }

    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Installing Selected Printers" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan

    foreach ($Printer in $Printers) {
        Write-Log "Installing: $($Printer.PrinterName)..." -Level Info
        Write-Host "  > $($Printer.PrinterName)" -ForegroundColor Yellow -NoNewline

        try {
            # Check if already installed
            $Existing = Get-Printer | Where-Object { $_.Name -eq $Printer.UNCPath }

            if ($Existing) {
                Write-Host " [Already Installed]" -ForegroundColor Gray
                Write-Log "Printer already installed: $($Printer.UNCPath)" -Level Info
                $Stats.Success++
                continue
            }

            # Install printer
            Add-Printer -ConnectionName $Printer.UNCPath -ErrorAction Stop

            Write-Host " [OK]" -ForegroundColor Green
            Write-Log "Successfully installed: $($Printer.PrinterName)" -Level Success
            $Stats.Success++
        }
        catch {
            Write-Host " [FAILED]" -ForegroundColor Red
            Write-Log "Failed to install $($Printer.PrinterName): $($_.Exception.Message)" -Level Error
            $Stats.Failed++
        }
    }

    return $Stats
}

function Set-DefaultPrinterInteractive {
    param([array]$InstalledPrinters)

    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Set Default Printer" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan

    Write-Host "Would you like to set a default printer? (Y/N): " -ForegroundColor Green -NoNewline
    $Response = Read-Host

    if ($Response -notmatch '^[Yy]') {
        Write-Log "User skipped default printer setup" -Level Info
        return
    }

    # Show installed printers
    for ($i = 0; $i -lt $InstalledPrinters.Count; $i++) {
        Write-Host "[$($i + 1)] $($InstalledPrinters[$i].PrinterName)" -ForegroundColor Yellow
    }

    Write-Host "`nSelect default printer (number): " -ForegroundColor Green -NoNewline
    $Selection = Read-Host

    try {
        $Index = [int]$Selection - 1
        if ($Index -ge 0 -and $Index -lt $InstalledPrinters.Count) {
            $DefaultPrinter = $InstalledPrinters[$Index]

            # Set as default
            $PrinterObject = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -like "*$($DefaultPrinter.ShareName)*" }
            if ($PrinterObject) {
                $PrinterObject.SetDefaultPrinter() | Out-Null
                Write-Log "Default printer set to: $($DefaultPrinter.PrinterName)" -Level Success
                Write-Host "Default printer set!" -ForegroundColor Green
            }
        }
        else {
            Write-Log "Invalid printer selection" -Level Warning
        }
    }
    catch {
        Write-Log "Failed to set default printer: $($_.Exception.Message)" -Level Error
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
Write-Host "`n" -NoNewline
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         Interactive Printer Selection Tool               ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Write-Log "=== Interactive Printer Selection Started ==="
Write-Log "Print Server: $PrintServer" -Level Info
Write-Log "User: $env:USERNAME" -Level Info
Write-Log "Computer: $env:COMPUTERNAME" -Level Info
Write-Log "Execution Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Level Info

# Step 1: Test print server connection
if (-not (Test-PrintServerConnection -ServerName $PrintServer)) {
    Write-Host "`nCannot reach print server: $PrintServer" -ForegroundColor Red
    Write-Log "Print server unreachable: $PrintServer" -Level Error
    exit 1
}

# Step 2: Query printers from server
try {
    $AvailablePrinters = Get-PrintServerPrinters -ServerName $PrintServer

    if ($AvailablePrinters.Count -eq 0) {
        Write-Host "`nNo printers found on server: $PrintServer" -ForegroundColor Yellow
        Write-Log "No printers found" -Level Warning
        exit 0
    }
}
catch {
    Write-Host "`nFailed to query print server: $($_.Exception.Message)" -ForegroundColor Red
    Write-Log "Print server query failed: $($_.Exception.Message)" -Level Error
    exit 1
}

# Step 3: Show printer selection (GUI or Console)
$SelectedPrinters = $null

if ($UseGUI) {
    try {
        # Test if Out-GridView is available
        Get-Command Out-GridView -ErrorAction Stop | Out-Null
        $SelectedPrinters = Show-PrinterSelectionGUI -Printers $AvailablePrinters

        # If GUI failed or user cancelled, fall back to console
        if ($null -eq $SelectedPrinters) {
            Write-Log "GUI selection cancelled, switching to console..." -Level Warning
            $SelectedPrinters = Show-PrinterSelectionConsole -Printers $AvailablePrinters
        }
    }
    catch {
        Write-Log "Out-GridView not available, using console menu" -Level Warning
        $SelectedPrinters = Show-PrinterSelectionConsole -Printers $AvailablePrinters
    }
}
else {
    $SelectedPrinters = Show-PrinterSelectionConsole -Printers $AvailablePrinters
}

# Check if user selected anything
if (-not $SelectedPrinters -or $SelectedPrinters.Count -eq 0) {
    Write-Host "`nNo printers selected. Exiting." -ForegroundColor Yellow
    Write-Log "No printers selected by user" -Level Info
    exit 0
}

# Step 4: Install selected printers
$InstallStats = Install-SelectedPrinters -Printers $SelectedPrinters

# Step 5: Optionally set default printer
if ($InstallStats.Success -gt 0) {
    Set-DefaultPrinterInteractive -InstalledPrinters $SelectedPrinters
}

# Step 6: Save configuration marker
$MarkerPath = "HKCU:\SOFTWARE\AutopilotDeployment\PrinterSelection"
Set-RegistryValue -Path $MarkerPath -Name "LastRun" -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Set-RegistryValue -Path $MarkerPath -Name "PrintServer" -Value $PrintServer
Set-RegistryValue -Path $MarkerPath -Name "PrintersInstalled" -Value $InstallStats.Success -Type DWord

# Summary
$Duration = (Get-Date) - $StartTime
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Installation Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total Selected:        $($InstallStats.Total)" -ForegroundColor White
Write-Host "Successfully Installed: " -ForegroundColor White -NoNewline
Write-Host "$($InstallStats.Success)" -ForegroundColor Green
Write-Host "Failed:                " -ForegroundColor White -NoNewline
Write-Host "$($InstallStats.Failed)" -ForegroundColor $(if($InstallStats.Failed -gt 0){'Red'}else{'White'})
Write-Host "Execution Time:        $([Math]::Round($Duration.TotalSeconds, 2)) seconds" -ForegroundColor White
Write-Host "Log File:              $LogPath" -ForegroundColor Gray
Write-Host ""

Write-Log "=== Printer Selection Completed ==="
Write-Log "Total: $($InstallStats.Total), Success: $($InstallStats.Success), Failed: $($InstallStats.Failed)" -Level Info

if ($InstallStats.Failed -eq 0) {
    Write-Host "All printers installed successfully!" -ForegroundColor Green
    Write-Log "All printers installed successfully" -Level Success
    exit 0
}
else {
    Write-Host "Some printers failed to install. Check log for details." -ForegroundColor Yellow
    Write-Log "Completed with $($InstallStats.Failed) error(s)" -Level Warning
    exit 1
}

#endregion
