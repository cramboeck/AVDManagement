<#
.SYNOPSIS
    Maps network drives for users during Autopilot v2 deployment.

.DESCRIPTION
    This script automatically maps network drives for users based on configuration.
    Supports multiple drives, authentication, reconnect at logon, and Azure AD joined devices.

    Designed for Autopilot v2 scenarios where network drive mappings need to be
    configured automatically during or after device deployment.

.PARAMETER DriveConfig
    Path to JSON configuration file containing drive mappings.
    See example configuration below.

.PARAMETER DriveLetter
    Single drive letter to map (e.g., "H", "S"). Used for single drive mapping.

.PARAMETER UNCPath
    UNC path to network share (e.g., \\server\share). Used for single drive mapping.

.PARAMETER Label
    Optional friendly name for the network drive.

.PARAMETER Username
    Optional username for authentication (format: domain\user or user@domain.com).

.PARAMETER Password
    Optional password for authentication. Use SecureString in production.

.PARAMETER Persistent
    If specified, drive reconnects at logon. Default: $true

.PARAMETER LogPath
    Path to log file. Defaults to C:\ProgramData\Intune\Logs\NetworkDrives.log

.EXAMPLE
    .\Map-NetworkDrives.ps1 -DriveLetter "H" -UNCPath "\\fileserver\home\%username%"

    Maps H: drive to user's home folder with automatic username replacement.

.EXAMPLE
    .\Map-NetworkDrives.ps1 -DriveConfig "C:\Config\DriveMapping.json"

    Maps multiple drives based on JSON configuration file.

.EXAMPLE
    .\Map-NetworkDrives.ps1 -DriveLetter "S" -UNCPath "\\fileserver\shared" -Label "Shared Files" -Persistent $true

    Maps S: drive with custom label and persistent connection.

.NOTES
    Version:        1.0
    Author:         Autopilot Deployment Team
    Creation Date:  2025-10-26

    Requirements:
    - Windows 11
    - Network connectivity to file servers
    - PowerShell 5.1 or later

    Intune Deployment:
    - Deploy as Win32 app (for SYSTEM context during device setup)
    - OR deploy as PowerShell script (for USER context at logon)
    - Recommended: Use Intune Drive Mapping Configuration Profile for production
    - This script useful for complex mappings or testing

    JSON Configuration Example:
    {
        "drives": [
            {
                "letter": "H",
                "path": "\\\\fileserver\\home\\%username%",
                "label": "Home Drive",
                "persistent": true
            },
            {
                "letter": "S",
                "path": "\\\\fileserver\\shared",
                "label": "Shared Files",
                "persistent": true
            },
            {
                "letter": "P",
                "path": "\\\\fileserver\\projects",
                "label": "Projects",
                "persistent": true,
                "username": "domain\\serviceaccount",
                "password": "SecurePassword123"
            }
        ]
    }

    Variable Replacements:
    - %username% : Current logged-in username
    - %computername% : Computer name
    - %userdomain% : User's domain
    - %userprofile% : User profile path
#>

[CmdletBinding(DefaultParameterSetName = 'SingleDrive')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'ConfigFile')]
    [ValidateScript({ Test-Path $_ })]
    [string]$DriveConfig,

    [Parameter(Mandatory = $true, ParameterSetName = 'SingleDrive')]
    [ValidatePattern('^[D-Z]$')]
    [string]$DriveLetter,

    [Parameter(Mandatory = $true, ParameterSetName = 'SingleDrive')]
    [ValidatePattern('^\\\\[^\\]+\\[^\\]+')]
    [string]$UNCPath,

    [Parameter(Mandatory = $false, ParameterSetName = 'SingleDrive')]
    [string]$Label = '',

    [Parameter(Mandatory = $false, ParameterSetName = 'SingleDrive')]
    [string]$Username = '',

    [Parameter(Mandatory = $false, ParameterSetName = 'SingleDrive')]
    [string]$Password = '',

    [Parameter(Mandatory = $false)]
    [bool]$Persistent = $true,

    [Parameter(Mandatory = $false)]
    [string]$LogPath = "C:\ProgramData\Intune\Logs\NetworkDrives.log"
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

function Expand-PathVariables {
    param([string]$Path)

    # Replace common variables
    $Path = $Path -replace '%username%', $env:USERNAME
    $Path = $Path -replace '%computername%', $env:COMPUTERNAME
    $Path = $Path -replace '%userdomain%', $env:USERDOMAIN
    $Path = $Path -replace '%userprofile%', $env:USERPROFILE

    return $Path
}

function Test-NetworkPath {
    param([string]$UNCPath)

    try {
        $TestPath = Split-Path -Path $UNCPath -Parent
        if (Test-Path -Path $TestPath -ErrorAction SilentlyContinue) {
            return $true
        }
        return $false
    }
    catch {
        return $false
    }
}

function Remove-ExistingMapping {
    param([string]$DriveLetter)

    try {
        $Drive = "${DriveLetter}:"
        if (Test-Path -Path $Drive) {
            Write-Log "Removing existing mapping for drive $Drive..." -Level Warning
            Remove-PSDrive -Name $DriveLetter -Force -ErrorAction SilentlyContinue
            & net use $Drive /delete /y 2>&1 | Out-Null
        }
    }
    catch {
        Write-Log "Error removing existing drive mapping: $($_.Exception.Message)" -Level Warning
    }
}

function New-NetworkDriveMapping {
    param(
        [string]$DriveLetter,
        [string]$UNCPath,
        [string]$Label = '',
        [string]$Username = '',
        [string]$Password = '',
        [bool]$Persistent = $true
    )

    Write-Log "Mapping drive $DriveLetter`: to $UNCPath..." -Level Info

    # Expand variables in path
    $ExpandedPath = Expand-PathVariables -Path $UNCPath
    Write-Log "Expanded path: $ExpandedPath" -Level Info

    # Remove existing mapping if present
    Remove-ExistingMapping -DriveLetter $DriveLetter

    try {
        $Drive = "${DriveLetter}:"

        # Build net use command
        $NetUseCmd = "net use $Drive `"$ExpandedPath`""

        if (-not [string]::IsNullOrWhiteSpace($Username) -and -not [string]::IsNullOrWhiteSpace($Password)) {
            $NetUseCmd += " /user:$Username $Password"
            Write-Log "Using credentials: $Username" -Level Info
        }

        if ($Persistent) {
            $NetUseCmd += " /persistent:yes"
        }
        else {
            $NetUseCmd += " /persistent:no"
        }

        # Execute mapping
        Write-Log "Executing: $($NetUseCmd -replace $Password, '***')" -Level Info
        $Result = Invoke-Expression $NetUseCmd 2>&1

        if ($LASTEXITCODE -eq 0) {
            Write-Log "Drive $Drive mapped successfully" -Level Success

            # Set drive label if specified
            if (-not [string]::IsNullOrWhiteSpace($Label)) {
                try {
                    $Shell = New-Object -ComObject Shell.Application
                    $Drive = $Shell.NameSpace($Drive)
                    if ($Drive) {
                        # Note: Changing network drive labels requires registry modification
                        $RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\MountPoints2\$($ExpandedPath -replace '\\','#')"
                        if (Test-Path $RegPath) {
                            Set-ItemProperty -Path $RegPath -Name "_LabelFromReg" -Value $Label -ErrorAction SilentlyContinue
                        }
                    }
                    Write-Log "Label set to: $Label" -Level Info
                }
                catch {
                    Write-Log "Could not set drive label: $($_.Exception.Message)" -Level Warning
                }
            }

            return $true
        }
        else {
            Write-Log "Failed to map drive: $Result" -Level Error
            return $false
        }
    }
    catch {
        Write-Log "Exception mapping drive: $($_.Exception.Message)" -Level Error
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
Write-Log "=== Network Drive Mapping for Autopilot v2 ==="
Write-Log "Execution Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Level Info
Write-Log "Current User: $env:USERNAME" -Level Info
Write-Log "Computer Name: $env:COMPUTERNAME" -Level Info

$Stats = @{
    Total = 0
    Success = 0
    Failed = 0
}

# Determine mapping mode
if ($PSCmdlet.ParameterSetName -eq 'ConfigFile') {
    Write-Log "Using configuration file: $DriveConfig" -Level Info

    try {
        $Config = Get-Content -Path $DriveConfig -Raw | ConvertFrom-Json

        if (-not $Config.drives) {
            Write-Log "No drives found in configuration file" -Level Error
            exit 1
        }

        Write-Log "Found $($Config.drives.Count) drive(s) to map" -Level Info

        foreach ($Drive in $Config.drives) {
            $Stats.Total++

            $DriveParams = @{
                DriveLetter = $Drive.letter
                UNCPath = $Drive.path
                Persistent = if ($null -ne $Drive.persistent) { $Drive.persistent } else { $true }
            }

            if ($Drive.label) { $DriveParams['Label'] = $Drive.label }
            if ($Drive.username) { $DriveParams['Username'] = $Drive.username }
            if ($Drive.password) { $DriveParams['Password'] = $Drive.password }

            if (New-NetworkDriveMapping @DriveParams) {
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
    # Single drive mapping
    Write-Log "Mapping single drive" -Level Info
    $Stats.Total = 1

    $DriveParams = @{
        DriveLetter = $DriveLetter
        UNCPath = $UNCPath
        Persistent = $Persistent
    }

    if ($Label) { $DriveParams['Label'] = $Label }
    if ($Username) { $DriveParams['Username'] = $Username }
    if ($Password) { $DriveParams['Password'] = $Password }

    if (New-NetworkDriveMapping @DriveParams) {
        $Stats.Success++
    }
    else {
        $Stats.Failed++
    }
}

# Save configuration marker
$MarkerPath = "HKCU:\SOFTWARE\AutopilotDeployment\NetworkDrives"
Set-RegistryValue -Path $MarkerPath -Name "MappedDate" -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Set-RegistryValue -Path $MarkerPath -Name "TotalDrives" -Value $Stats.Total -Type DWord
Set-RegistryValue -Path $MarkerPath -Name "SuccessfulDrives" -Value $Stats.Success -Type DWord

# Summary
$Duration = (Get-Date) - $StartTime
Write-Log "`n=== Network Drive Mapping Completed ==="
Write-Log "Total Drives: $($Stats.Total)" -Level Info
Write-Log "Successfully Mapped: $($Stats.Success)" -Level Success
Write-Log "Failed: $($Stats.Failed)" -Level $(if ($Stats.Failed -gt 0) { 'Error' } else { 'Info' })
Write-Log "Execution Time: $([Math]::Round($Duration.TotalSeconds, 2)) seconds" -Level Info
Write-Log "Log File: $LogPath" -Level Info

Write-Log "`n=== Important Notes ==="
Write-Log "1. Network drives are mapped for current user" -Level Info
Write-Log "2. Persistent drives reconnect at next logon" -Level Info
Write-Log "3. Ensure network connectivity to file servers" -Level Warning
Write-Log "4. For Azure AD joined devices, consider using Intune Drive Mapping policies" -Level Info

if ($Stats.Failed -eq 0) {
    Write-Log "`nAll network drives mapped successfully!" -Level Success
    exit 0
}
else {
    Write-Log "`nSome drive mappings failed. Check log for details." -Level Warning
    exit 1
}

#endregion
