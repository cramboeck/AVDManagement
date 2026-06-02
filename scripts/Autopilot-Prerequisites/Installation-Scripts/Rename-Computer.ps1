<#
.SYNOPSIS
    Renames computer during Autopilot v2 deployment using Prefix + Serial Number.

.DESCRIPTION
    This script renames Windows computers during Autopilot v2 deployment using a simple
    naming pattern: Prefix + Device Serial Number.

    Example: Prefix "WKS" → Computer name "WKS-12345678"
    Example: Prefix "IND-LAPTOP" → Computer name "IND-LAPTOP-12345678"

    Designed for Autopilot v2 scenarios where computer renaming needs to happen early
    in the deployment process, before domain join or Azure AD registration.

.PARAMETER Prefix
    Prefix to add before the serial number (e.g., "WKS", "LAPTOP", "IND-PC").
    The serial number is automatically appended after the prefix.
    Default: "WKS"

.PARAMETER Suffix
    Optional suffix to add after the serial number (e.g., location code, department).
    Example: Prefix "WKS", Suffix "DE" → WKS-12345678-DE

.PARAMETER MaxLength
    Maximum length of computer name (Windows limit is 15 characters).
    If the generated name is longer, it will be automatically truncated.
    Default: 15

.PARAMETER ForceReboot
    If specified, forces an immediate reboot after renaming.
    Default: $false (Autopilot ESP will handle the reboot)

.PARAMETER LogPath
    Path to log file. Defaults to C:\ProgramData\Intune\Logs\ComputerRename.log

.EXAMPLE
    .\Rename-Computer.ps1 -Prefix "WKS"

    Renames computer to WKS-<SerialNumber> (e.g., WKS-1A2B3C4D5E)

.EXAMPLE
    .\Rename-Computer.ps1 -Prefix "IND-LAPTOP"

    Renames computer to IND-LAPTOP-<SerialNumber> (e.g., IND-LAPTOP-1A2B3C4D)

.EXAMPLE
    .\Rename-Computer.ps1 -Prefix "DE-WKS" -Suffix "MUC"

    Renames computer to DE-WKS-<SerialNumber>-MUC (e.g., DE-WKS-1A2B3C-MUC)

.EXAMPLE
    .\Rename-Computer.ps1 -Prefix "PC" -MaxLength 12

    Renames computer to PC-<Serial> with max 12 characters (e.g., PC-1A2B3C4D)

.NOTES
    Version:        2.0
    Author:         Autopilot Deployment Team
    Creation Date:  2025-10-26
    Last Modified:  2025-10-26

    Requirements:
    - Windows 11
    - Administrator privileges
    - PowerShell 5.1 or later

    Intune Deployment:
    - Deploy as Win32 app or via Device Configuration > Scripts
    - Run in SYSTEM context
    - Recommended: Deploy in Device Preparation phase for Autopilot v2
    - Computer will need reboot to apply new name

    Autopilot v2 Integration:
    - Runs during Device Preparation phase
    - Computer rename applied before Azure AD join
    - Reboot handled by Autopilot ESP

    Naming Pattern:
    - Always uses: Prefix + "-" + Serial Number
    - Optional: + "-" + Suffix
    - Automatically truncated if longer than MaxLength
    - Serial number cleaned of special characters
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false, HelpMessage = "Prefix for computer name (e.g., WKS, LAPTOP, IND-PC)")]
    [ValidateLength(1, 10)]
    [string]$Prefix = 'WKS',

    [Parameter(Mandatory = $false, HelpMessage = "Optional suffix after serial number (e.g., DE, MUC, IT)")]
    [ValidateLength(0, 5)]
    [string]$Suffix = '',

    [Parameter(Mandatory = $false)]
    [ValidateRange(1, 15)]
    [int]$MaxLength = 15,

    [Parameter(Mandatory = $false)]
    [bool]$ForceReboot = $false,

    [Parameter(Mandatory = $false)]
    [string]$LogPath = "C:\ProgramData\Intune\Logs\ComputerRename.log"
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

function Get-DeviceSerialNumber {
    try {
        $Serial = (Get-CimInstance -ClassName Win32_BIOS).SerialNumber
        if ([string]::IsNullOrWhiteSpace($Serial)) {
            Write-Log "Serial number is empty, using fallback" -Level Warning
            return "UNKNOWN"
        }

        # Clean serial number (remove spaces, special chars, keep only alphanumeric)
        $Serial = $Serial -replace '[^a-zA-Z0-9]', ''

        # Some vendors have very long serial numbers, limit to reasonable length
        if ($Serial.Length -gt 12) {
            $Serial = $Serial.Substring(0, 12)
        }

        return $Serial.ToUpper()
    }
    catch {
        Write-Log "Failed to get serial number: $($_.Exception.Message)" -Level Error
        return "ERROR"
    }
}

function New-ComputerName {
    param(
        [string]$Prefix,
        [string]$SerialNumber,
        [string]$Suffix,
        [int]$MaxLength
    )

    # Build computer name: Prefix-SerialNumber-Suffix
    $NewName = $Prefix.ToUpper()

    # Add serial number
    if (-not [string]::IsNullOrWhiteSpace($SerialNumber)) {
        $NewName += "-$SerialNumber"
    }
    else {
        Write-Log "Serial number is empty, using only prefix" -Level Warning
    }

    # Add suffix if provided
    if (-not [string]::IsNullOrWhiteSpace($Suffix)) {
        $NewName += "-$($Suffix.ToUpper())"
    }

    # Truncate if necessary
    if ($NewName.Length -gt $MaxLength) {
        Write-Log "Computer name too long ($($NewName.Length) chars), truncating to $MaxLength chars" -Level Warning

        # Try to truncate intelligently - keep prefix intact, truncate serial/suffix
        if ($Suffix) {
            # Remove suffix first if it exists
            $NewName = $Prefix.ToUpper() + "-" + $SerialNumber
            if ($NewName.Length -gt $MaxLength) {
                # Still too long, truncate serial number
                $NewName = $NewName.Substring(0, $MaxLength)
            }
        }
        else {
            # No suffix, just truncate
            $NewName = $NewName.Substring(0, $MaxLength)
        }
    }

    # Remove any invalid characters (Windows computer names: A-Z, 0-9, hyphen)
    $NewName = $NewName -replace '[^a-zA-Z0-9\-]', ''

    # Ensure name doesn't start or end with hyphen
    $NewName = $NewName.Trim('-')

    return $NewName
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
Write-Log "=== Computer Rename for Autopilot v2 ==="
Write-Log "Naming Pattern: Prefix + Serial Number" -Level Info
Write-Log "Prefix: $Prefix" -Level Info
if (-not [string]::IsNullOrWhiteSpace($Suffix)) {
    Write-Log "Suffix: $Suffix" -Level Info
}
Write-Log "Max Length: $MaxLength" -Level Info
Write-Log "Execution Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Level Info

# Get current computer name
$CurrentName = $env:COMPUTERNAME
Write-Log "Current computer name: $CurrentName" -Level Info

# Get serial number
Write-Log "Retrieving device serial number..." -Level Info
$SerialNumber = Get-DeviceSerialNumber
Write-Log "Device serial number: $SerialNumber" -Level Success

# Generate new computer name
try {
    $NewName = New-ComputerName -Prefix $Prefix -SerialNumber $SerialNumber -Suffix $Suffix -MaxLength $MaxLength
    Write-Log "Generated new computer name: $NewName" -Level Success
}
catch {
    Write-Log "Failed to generate computer name: $($_.Exception.Message)" -Level Error
    exit 1
}

# Validate new name
if ($NewName.Length -lt 1 -or $NewName.Length -gt 15) {
    Write-Log "Invalid computer name length: $($NewName.Length) characters" -Level Error
    exit 1
}

if ($NewName -match '^[0-9]') {
    Write-Log "Computer name cannot start with a number: $NewName" -Level Error
    exit 1
}

# Check if name is already correct
if ($CurrentName -eq $NewName) {
    Write-Log "Computer is already named correctly: $NewName" -Level Info
    Write-Log "No rename necessary" -Level Success

    # Save marker
    $MarkerPath = "HKLM:\SOFTWARE\AutopilotDeployment\ComputerRename"
    Set-RegistryValue -Path $MarkerPath -Name "CurrentName" -Value $NewName
    Set-RegistryValue -Path $MarkerPath -Name "RenameDate" -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    Set-RegistryValue -Path $MarkerPath -Name "Prefix" -Value $Prefix
    Set-RegistryValue -Path $MarkerPath -Name "SerialNumber" -Value $SerialNumber

    exit 0
}

# Rename computer
Write-Log "Renaming computer from '$CurrentName' to '$NewName'..." -Level Info
try {
    Rename-Computer -NewName $NewName -Force -ErrorAction Stop
    Write-Log "Computer renamed successfully to: $NewName" -Level Success

    # Save configuration marker
    $MarkerPath = "HKLM:\SOFTWARE\AutopilotDeployment\ComputerRename"
    Set-RegistryValue -Path $MarkerPath -Name "OldName" -Value $CurrentName
    Set-RegistryValue -Path $MarkerPath -Name "NewName" -Value $NewName
    Set-RegistryValue -Path $MarkerPath -Name "RenameDate" -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    Set-RegistryValue -Path $MarkerPath -Name "Prefix" -Value $Prefix
    Set-RegistryValue -Path $MarkerPath -Name "SerialNumber" -Value $SerialNumber
    if ($Suffix) {
        Set-RegistryValue -Path $MarkerPath -Name "Suffix" -Value $Suffix
    }
    Set-RegistryValue -Path $MarkerPath -Name "RebootPending" -Value "True"

    $Success = $true
}
catch {
    Write-Log "Failed to rename computer: $($_.Exception.Message)" -Level Error
    exit 1
}

# Summary
$Duration = (Get-Date) - $StartTime
Write-Log "`n=== Computer Rename Completed ==="
Write-Log "Old Name: $CurrentName" -Level Info
Write-Log "New Name: $NewName" -Level Success
Write-Log "Pattern: $Prefix + Serial Number" -Level Info
Write-Log "Serial Number: $SerialNumber" -Level Info
if ($Suffix) {
    Write-Log "Suffix: $Suffix" -Level Info
}
Write-Log "Execution Time: $([Math]::Round($Duration.TotalSeconds, 2)) seconds" -Level Info

Write-Log "`n=== Important Notes ==="
Write-Log "1. A REBOOT is REQUIRED for the new name to take effect" -Level Warning
Write-Log "2. In Autopilot v2, reboot is handled automatically by ESP" -Level Info
Write-Log "3. New name will be visible after reboot" -Level Info
Write-Log "4. Log file: $LogPath" -Level Info

if ($ForceReboot) {
    Write-Log "`nForced reboot initiated (parameter)..." -Level Warning
    Start-Sleep -Seconds 5
    Restart-Computer -Force
}
else {
    Write-Log "`nReboot not forced. System will reboot during Autopilot ESP." -Level Info
}

exit 0

#endregion
