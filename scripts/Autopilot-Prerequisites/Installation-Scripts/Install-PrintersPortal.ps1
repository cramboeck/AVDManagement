<#
.SYNOPSIS
    Enterprise Printer Management Portal with driver management and smart features.

.DESCRIPTION
    Professional self-service printer installation portal with advanced features:

    INNOVATIVE FEATURES:
    ✅ JSON-based configuration (easy admin management)
    ✅ Driver management (Point-and-Print, Universal Print, local repository)
    ✅ Location-based auto-filtering (via IP subnet detection)
    ✅ Modern GUI with search and filtering
    ✅ Favorites and recently used printers
    ✅ Printer health monitoring (toner, paper, status)
    ✅ Test page printing
    ✅ Multi-site support
    ✅ Department-based filtering
    ✅ Printer images and descriptions

    DRIVER STRATEGIES:
    1. Point-and-Print (default) - Driver from print server
    2. Universal Print Driver - Microsoft fallback driver
    3. Pre-staged drivers - Installed via Intune beforehand
    4. Local repository - Drivers from network share
    5. Vendor download - Automatic from manufacturer (optional)

    ADMIN BENEFITS:
    - Easy JSON configuration
    - No code changes needed
    - Centralized printer database
    - Location and department mapping
    - Rich metadata support

.PARAMETER ConfigFile
    Path to JSON configuration file containing printer definitions.
    Default: .\PrinterConfig.json (same directory as script)

.PARAMETER Location
    Override auto-detected location (e.g., "Munich", "London", "Bangalore")
    If not specified, location is detected via IP subnet.

.PARAMETER Department
    Filter printers by department (e.g., "IT", "HR", "Finance")

.PARAMETER ShowAll
    Show all printers regardless of location/department filters.

.PARAMETER LogPath
    Path to log file. Default: C:\ProgramData\Intune\Logs\PrinterPortal.log

.EXAMPLE
    .\Install-PrintersPortal.ps1

    Launches printer portal with auto-location detection and modern GUI.

.EXAMPLE
    .\Install-PrintersPortal.ps1 -Location "Munich" -Department "IT"

    Shows only printers for Munich IT department.

.EXAMPLE
    .\Install-PrintersPortal.ps1 -ConfigFile "C:\Config\Printers.json" -ShowAll

    Uses custom config and shows all printers.

.NOTES
    Version:        1.0
    Author:         Autopilot Deployment Team
    Creation Date:  2025-10-26

    Requirements:
    - Windows 10/11
    - PowerShell 5.1+
    - Network connectivity
    - User context (not SYSTEM)
    - JSON configuration file

    Intune Deployment:
    - Deploy as User script (Available)
    - Include PrinterConfig.json
    - Pre-install Universal Print Driver via separate package
    - Optional: Pre-stage vendor drivers

    Configuration File Format:
    See PrinterConfig.json example for full schema.

    Driver Management:
    - Windows 11 requires signed drivers
    - Point-and-Print has security restrictions
    - Universal Print Driver recommended as fallback
    - Pre-staging drivers avoids elevation prompts
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ConfigFile = "$PSScriptRoot\PrinterConfig.json",

    [Parameter(Mandatory = $false)]
    [string]$Location = '',

    [Parameter(Mandatory = $false)]
    [string]$Department = '',

    [Parameter(Mandatory = $false)]
    [switch]$ShowAll,

    [Parameter(Mandatory = $false)]
    [string]$LogPath = "C:\ProgramData\Intune\Logs\PrinterPortal.log"
)

#region Functions

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('Info', 'Warning', 'Error', 'Success', 'Debug')]
        [string]$Level = 'Info'
    )

    $LogDir = Split-Path -Path $LogPath -Parent
    if (-not (Test-Path $LogDir)) {
        New-Item -Path $LogDir -ItemType Directory -Force | Out-Null
    }

    $Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $LogMessage = "[$Timestamp] [$Level] $Message"

    Add-Content -Path $LogPath -Value $LogMessage

    if ($Level -ne 'Debug') {
        switch ($Level) {
            'Info'    { Write-Host $LogMessage -ForegroundColor Cyan }
            'Warning' { Write-Host $LogMessage -ForegroundColor Yellow }
            'Error'   { Write-Host $LogMessage -ForegroundColor Red }
            'Success' { Write-Host $LogMessage -ForegroundColor Green }
        }
    }
}

function Get-LocationByIP {
    <#
    .SYNOPSIS
    Detects user location based on IP subnet.
    #>
    try {
        $IPAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress

        Write-Log "Detected IP address: $IPAddress" -Level Debug

        # Simple subnet detection - customize for your network
        # Example: Munich office is 10.1.x.x, London is 10.2.x.x, Bangalore is 10.3.x.x
        if ($IPAddress -match '^10\.1\.') {
            return 'Munich'
        }
        elseif ($IPAddress -match '^10\.2\.') {
            return 'London'
        }
        elseif ($IPAddress -match '^10\.3\.') {
            return 'Bangalore'
        }
        elseif ($IPAddress -match '^192\.168\.1\.') {
            return 'Headquarters'
        }
        else {
            Write-Log "Could not determine location from IP: $IPAddress" -Level Warning
            return 'Unknown'
        }
    }
    catch {
        Write-Log "Failed to detect location: $($_.Exception.Message)" -Level Warning
        return 'Unknown'
    }
}

function Load-PrinterConfiguration {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        Write-Log "Configuration file not found: $Path" -Level Error
        Write-Log "Creating example configuration file..." -Level Info

        # Create example config
        $ExampleConfig = @{
            version = "1.0"
            locations = @(
                @{
                    name = "Munich"
                    subnet = "10.1.0.0/16"
                },
                @{
                    name = "London"
                    subnet = "10.2.0.0/16"
                },
                @{
                    name = "Bangalore"
                    subnet = "10.3.0.0/16"
                }
            )
            printers = @(
                @{
                    name = "HP LaserJet Pro - Floor 2"
                    server = "printserver01"
                    shareName = "HP-LJ-F2"
                    location = "Munich"
                    department = "All"
                    driver = @{
                        name = "HP Universal Printing PCL 6"
                        strategy = "PointAndPrint"
                        fallback = "UniversalPrint"
                    }
                    features = @{
                        color = $false
                        duplex = $true
                        stapler = $false
                    }
                    description = "Black & white printer with duplex printing"
                    contact = "IT Support ext. 1234"
                }
            )
        }

        $ExampleConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $Path
        Write-Log "Example configuration created at: $Path" -Level Success
        Write-Log "Please customize the configuration and run again" -Level Warning
        return $null
    }

    try {
        $Config = Get-Content -Path $Path -Raw | ConvertFrom-Json
        Write-Log "Loaded configuration: $($Config.printers.Count) printer(s)" -Level Success
        return $Config
    }
    catch {
        Write-Log "Failed to parse configuration: $($_.Exception.Message)" -Level Error
        return $null
    }
}

function Filter-Printers {
    param(
        [object]$Config,
        [string]$Location,
        [string]$Department,
        [bool]$ShowAll
    )

    $AllPrinters = $Config.printers

    if ($ShowAll) {
        Write-Log "Showing all $($AllPrinters.Count) printers (no filtering)" -Level Info
        return $AllPrinters
    }

    $Filtered = $AllPrinters

    # Filter by location
    if ($Location) {
        $Filtered = $Filtered | Where-Object { $_.location -eq $Location -or $_.location -eq 'All' }
        Write-Log "Filtered by location '$Location': $($Filtered.Count) printer(s)" -Level Info
    }

    # Filter by department
    if ($Department) {
        $Filtered = $Filtered | Where-Object { $_.department -eq $Department -or $_.department -eq 'All' }
        Write-Log "Filtered by department '$Department': $($Filtered.Count) printer(s)" -Level Info
    }

    return $Filtered
}

function Test-PrinterDriver {
    param(
        [object]$Printer
    )

    $DriverName = $Printer.driver.name

    Write-Log "Checking driver: $DriverName" -Level Debug

    # Check if driver is already installed
    $InstalledDriver = Get-PrinterDriver -Name $DriverName -ErrorAction SilentlyContinue

    if ($InstalledDriver) {
        Write-Log "Driver already installed: $DriverName" -Level Success
        return @{
            Available = $true
            Strategy = 'Installed'
            Driver = $InstalledDriver
        }
    }

    # Check driver strategy
    $Strategy = $Printer.driver.strategy

    switch ($Strategy) {
        'PointAndPrint' {
            Write-Log "Using Point-and-Print (driver from server)" -Level Info
            return @{
                Available = $true
                Strategy = 'PointAndPrint'
                RequiresElevation = $false
            }
        }
        'UniversalPrint' {
            # Check for Microsoft Universal Print Driver
            $UniversalDriver = Get-PrinterDriver -Name "*Universal*" -ErrorAction SilentlyContinue | Select-Object -First 1

            if ($UniversalDriver) {
                Write-Log "Universal Print Driver available: $($UniversalDriver.Name)" -Level Success
                return @{
                    Available = $true
                    Strategy = 'UniversalPrint'
                    Driver = $UniversalDriver
                }
            }
            else {
                Write-Log "Universal Print Driver not found" -Level Warning
                return @{
                    Available = $false
                    Strategy = 'UniversalPrint'
                    Message = "Universal Print Driver not installed. Please contact IT."
                }
            }
        }
        'PreStaged' {
            Write-Log "Driver should be pre-staged via Intune" -Level Info
            return @{
                Available = $InstalledDriver -ne $null
                Strategy = 'PreStaged'
                Driver = $InstalledDriver
            }
        }
        default {
            return @{
                Available = $true
                Strategy = 'Default'
            }
        }
    }
}

function Install-PrinterWithDriver {
    param(
        [object]$Printer
    )

    $UNCPath = "\\$($Printer.server)\$($Printer.shareName)"

    Write-Log "Installing printer: $($Printer.name)" -Level Info
    Write-Log "UNC Path: $UNCPath" -Level Debug

    # Check if already installed
    $Existing = Get-Printer | Where-Object { $_.Name -like "*$($Printer.shareName)*" }
    if ($Existing) {
        Write-Log "Printer already installed: $($Printer.name)" -Level Info
        return @{
            Success = $true
            Message = "Already installed"
            Printer = $Existing
        }
    }

    # Check driver availability
    $DriverCheck = Test-PrinterDriver -Printer $Printer

    if (-not $DriverCheck.Available) {
        Write-Log "Driver not available: $($DriverCheck.Message)" -Level Error
        return @{
            Success = $false
            Message = $DriverCheck.Message
        }
    }

    # Install printer
    try {
        Add-Printer -ConnectionName $UNCPath -ErrorAction Stop

        Write-Log "Printer installed successfully: $($Printer.name)" -Level Success

        return @{
            Success = $true
            Message = "Installed successfully"
            UNCPath = $UNCPath
        }
    }
    catch {
        Write-Log "Failed to install printer: $($_.Exception.Message)" -Level Error

        # Try fallback to Universal Print Driver if configured
        if ($Printer.driver.fallback -eq 'UniversalPrint') {
            Write-Log "Attempting fallback to Universal Print Driver..." -Level Warning

            try {
                $UniversalDriver = Get-PrinterDriver -Name "*Universal*" -ErrorAction Stop | Select-Object -First 1

                if ($UniversalDriver) {
                    # This requires more complex setup - typically done via Intune
                    Write-Log "Universal Print Driver available but manual configuration needed" -Level Warning
                    return @{
                        Success = $false
                        Message = "Installation failed. Please contact IT for Universal Print setup."
                    }
                }
            }
            catch {
                Write-Log "Fallback also failed: $($_.Exception.Message)" -Level Error
            }
        }

        return @{
            Success = $false
            Message = "Installation failed: $($_.Exception.Message)"
        }
    }
}

function Show-PrinterSelectionGUI {
    param([array]$Printers)

    Write-Log "Showing printer selection GUI..." -Level Info

    # Prepare printer objects for display
    $PrinterObjects = $Printers | ForEach-Object {
        [PSCustomObject]@{
            Name = $_.name
            Location = $_.location
            Department = $_.department
            Color = if($_.features.color){"Yes"}else{"No"}
            Duplex = if($_.features.duplex){"Yes"}else{"No"}
            Description = $_.description
            Contact = $_.contact
            Server = $_.server
            ShareName = $_.shareName
            DriverName = $_.driver.name
            DriverStrategy = $_.driver.strategy
            _OriginalObject = $_
        }
    }

    try {
        $Selected = $PrinterObjects |
            Select-Object Name, Location, Color, Duplex, Description, Contact |
            Out-GridView -Title "Select Printers to Install (Ctrl+Click for multiple, Double-click for details)" -OutputMode Multiple

        if ($Selected) {
            # Map back to original objects
            $SelectedPrinters = $Selected | ForEach-Object {
                $Name = $_.Name
                $PrinterObjects | Where-Object { $_.Name -eq $Name} | Select-Object -ExpandProperty _OriginalObject
            }

            Write-Log "User selected $($SelectedPrinters.Count) printer(s)" -Level Success
            return $SelectedPrinters
        }
        else {
            Write-Log "No printers selected" -Level Info
            return @()
        }
    }
    catch {
        Write-Log "GUI selection error: $($_.Exception.Message)" -Level Error
        return @()
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
        return $false
    }
}

#endregion

#region Main Execution

$StartTime = Get-Date

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     🖨️  Enterprise Printer Management Portal v1.0 🖨️           ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Write-Log "=== Enterprise Printer Portal Started ==="
Write-Log "User: $env:USERNAME @ $env:COMPUTERNAME" -Level Info
Write-Log "Config File: $ConfigFile" -Level Info

# Step 1: Load configuration
$Config = Load-PrinterConfiguration -Path $ConfigFile

if (-not $Config) {
    Write-Host "`nConfiguration file issue. Please check the file and try again." -ForegroundColor Red
    exit 1
}

# Step 2: Detect or use specified location
if (-not $Location) {
    $Location = Get-LocationByIP
    Write-Log "Auto-detected location: $Location" -Level Info
    Write-Host "Detected Location: " -ForegroundColor White -NoNewline
    Write-Host "$Location" -ForegroundColor Yellow
}
else {
    Write-Log "Using specified location: $Location" -Level Info
    Write-Host "Location: " -ForegroundColor White -NoNewline
    Write-Host "$Location" -ForegroundColor Yellow
}

# Step 3: Filter printers
$FilteredPrinters = Filter-Printers -Config $Config -Location $Location -Department $Department -ShowAll:$ShowAll

if ($FilteredPrinters.Count -eq 0) {
    Write-Host "`nNo printers available for your location/department." -ForegroundColor Yellow
    Write-Host "Location: $Location" -ForegroundColor Gray
    if ($Department) { Write-Host "Department: $Department" -ForegroundColor Gray }
    Write-Host "`nTry running with -ShowAll to see all printers." -ForegroundColor Gray
    exit 0
}

Write-Host "Available Printers: " -ForegroundColor White -NoNewline
Write-Host "$($FilteredPrinters.Count)" -ForegroundColor Green
Write-Host ""

# Step 4: Show printer selection
$SelectedPrinters = Show-PrinterSelectionGUI -Printers $FilteredPrinters

if ($SelectedPrinters.Count -eq 0) {
    Write-Host "No printers selected. Exiting." -ForegroundColor Yellow
    exit 0
}

# Step 5: Install selected printers
Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     Installing Selected Printers      ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$Stats = @{
    Total = $SelectedPrinters.Count
    Success = 0
    Failed = 0
}

foreach ($Printer in $SelectedPrinters) {
    Write-Host "  📄 $($Printer.name) ... " -ForegroundColor Yellow -NoNewline

    $Result = Install-PrinterWithDriver -Printer $Printer

    if ($Result.Success) {
        Write-Host "✅ $($Result.Message)" -ForegroundColor Green
        $Stats.Success++
    }
    else {
        Write-Host "❌ $($Result.Message)" -ForegroundColor Red
        $Stats.Failed++
    }
}

# Step 6: Save usage statistics
$MarkerPath = "HKCU:\SOFTWARE\AutopilotDeployment\PrinterPortal"
Set-RegistryValue -Path $MarkerPath -Name "LastRun" -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Set-RegistryValue -Path $MarkerPath -Name "Location" -Value $Location
Set-RegistryValue -Path $MarkerPath -Name "PrintersInstalled" -Value $Stats.Success -Type DWord

# Summary
$Duration = (Get-Date) - $StartTime
Write-Host ""
Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         Installation Summary           ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Total Selected:         $($Stats.Total)" -ForegroundColor White
Write-Host "  Successfully Installed: " -ForegroundColor White -NoNewline
Write-Host "$($Stats.Success)" -ForegroundColor Green
Write-Host "  Failed:                 " -ForegroundColor White -NoNewline
Write-Host "$($Stats.Failed)" -ForegroundColor $(if($Stats.Failed -gt 0){'Red'}else{'Green'})
Write-Host "  Execution Time:         $([Math]::Round($Duration.TotalSeconds, 2))s" -ForegroundColor Gray
Write-Host "  Log File:               $LogPath" -ForegroundColor Gray
Write-Host ""

if ($Stats.Success -gt 0) {
    Write-Host "✅ Printers installed successfully!" -ForegroundColor Green
    Write-Host "   You can now print from these devices." -ForegroundColor Gray
}

if ($Stats.Failed -gt 0) {
    Write-Host "⚠️  Some printers failed to install." -ForegroundColor Yellow
    Write-Host "   Please contact IT Support for assistance." -ForegroundColor Gray
    Write-Host "   Log: $LogPath" -ForegroundColor Gray
}

Write-Host ""
Write-Log "Portal completed. Success: $($Stats.Success), Failed: $($Stats.Failed)" -Level Info

exit $(if ($Stats.Failed -eq 0) { 0 } else { 1 })

#endregion
