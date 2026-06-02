<#
.SYNOPSIS
    Configures Windows 11 regional settings (time zone, formats, currency) by country code.

.DESCRIPTION
    This script sets Windows 11 regional settings based on a country code parameter.

    IMPORTANT: This script does NOT change the display language!
    It only configures regional settings like:
    - Time zone (e.g., India Standard Time)
    - Regional formats (date/time format, currency symbol, number format)
    - Geographic location (for regional content)
    - System locale for non-Unicode programs

    The Windows display language remains unchanged.

    Designed for international deployments where regional settings need to match
    the local country but you want to keep the existing display language.

.PARAMETER CountryCode
    Two-letter ISO 3166-1 alpha-2 country code (e.g., IN, DE, GB, US, FR, AU)

    Supported countries:
    - IN: India
    - DE: Germany
    - GB: United Kingdom
    - US: United States
    - FR: France
    - AU: Australia
    - JP: Japan
    - SG: Singapore
    - CN: China
    - NL: Netherlands
    - BE: Belgium
    - CH: Switzerland
    - AT: Austria
    - IT: Italy
    - ES: Spain
    - SE: Sweden
    - NO: Norway
    - DK: Denmark
    - FI: Finland
    - PL: Poland
    - CZ: Czech Republic
    - IE: Ireland
    - PT: Portugal
    - BR: Brazil
    - MX: Mexico
    - CA: Canada
    - NZ: New Zealand

.PARAMETER SetTimeZone
    If specified, configures the time zone for the country.
    Default: $true

.PARAMETER LogPath
    Path to log file. Defaults to C:\ProgramData\Intune\Logs\Win11Localization.log

.EXAMPLE
    .\Set-Win11Localization.ps1 -CountryCode "IN"

    Configures Windows 11 for India:
    - Time zone: India Standard Time (IST)
    - Currency: INR (₹)
    - Date format: DD/MM/YYYY
    - Number format: 1,00,000.00 (Indian)
    - Display language: Unchanged

.EXAMPLE
    .\Set-Win11Localization.ps1 -CountryCode "DE" -SetTimeZone:$false

    Configures Windows 11 for Germany without changing time zone:
    - Currency: EUR (€)
    - Date format: DD.MM.YYYY
    - Number format: 1.000.000,00 (German)
    - Display language: Unchanged
    - Time zone: Unchanged

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
    - Detection: Registry key check for configured country code

    What this script DOES:
    - Set regional format (date/time/currency/numbers)
    - Set time zone
    - Set geographic location
    - Set system locale for non-Unicode programs

    What this script DOES NOT do:
    - Change display language
    - Change keyboard layout
    - Modify language packs
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Two-letter country code (e.g., IN, DE, GB, US)")]
    [ValidateSet(
        'IN', 'DE', 'GB', 'US', 'FR', 'AU', 'JP', 'SG', 'CN',
        'NL', 'BE', 'CH', 'AT', 'IT', 'ES', 'SE', 'NO', 'DK',
        'FI', 'PL', 'CZ', 'IE', 'PT', 'BR', 'MX', 'CA', 'NZ'
    )]
    [string]$CountryCode,

    [Parameter(Mandatory = $false)]
    [bool]$SetTimeZone = $true,

    [Parameter(Mandatory = $false)]
    [string]$LogPath = "C:\ProgramData\Intune\Logs\Win11Localization.log"
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
        Write-Log "Set registry: $Path\$Name = $Value"
        return $true
    }
    catch {
        Write-Log "Failed to set registry $Path\$Name : $($_.Exception.Message)" -Level Error
        return $false
    }
}

#endregion

#region Country Configuration Database

$CountryConfig = @{
    'IN' = @{
        Name = 'India'
        TimeZone = 'India Standard Time'
        GeoId = 113  # India
        Culture = 'en-IN'
        Location = 'IN'
    }
    'DE' = @{
        Name = 'Germany'
        TimeZone = 'W. Europe Standard Time'
        GeoId = 94  # Germany
        Culture = 'de-DE'
        Location = 'DE'
    }
    'GB' = @{
        Name = 'United Kingdom'
        TimeZone = 'GMT Standard Time'
        GeoId = 242  # United Kingdom
        Culture = 'en-GB'
        Location = 'GB'
    }
    'US' = @{
        Name = 'United States'
        TimeZone = 'Eastern Standard Time'
        GeoId = 244  # United States
        Culture = 'en-US'
        Location = 'US'
    }
    'FR' = @{
        Name = 'France'
        TimeZone = 'Romance Standard Time'
        GeoId = 84  # France
        Culture = 'fr-FR'
        Location = 'FR'
    }
    'AU' = @{
        Name = 'Australia'
        TimeZone = 'AUS Eastern Standard Time'
        GeoId = 12  # Australia
        Culture = 'en-AU'
        Location = 'AU'
    }
    'JP' = @{
        Name = 'Japan'
        TimeZone = 'Tokyo Standard Time'
        GeoId = 122  # Japan
        Culture = 'ja-JP'
        Location = 'JP'
    }
    'SG' = @{
        Name = 'Singapore'
        TimeZone = 'Singapore Standard Time'
        GeoId = 215  # Singapore
        Culture = 'en-SG'
        Location = 'SG'
    }
    'CN' = @{
        Name = 'China'
        TimeZone = 'China Standard Time'
        GeoId = 45  # China
        Culture = 'zh-CN'
        Location = 'CN'
    }
    'NL' = @{
        Name = 'Netherlands'
        TimeZone = 'W. Europe Standard Time'
        GeoId = 176  # Netherlands
        Culture = 'nl-NL'
        Location = 'NL'
    }
    'BE' = @{
        Name = 'Belgium'
        TimeZone = 'Romance Standard Time'
        GeoId = 21  # Belgium
        Culture = 'nl-BE'
        Location = 'BE'
    }
    'CH' = @{
        Name = 'Switzerland'
        TimeZone = 'W. Europe Standard Time'
        GeoId = 223  # Switzerland
        Culture = 'de-CH'
        Location = 'CH'
    }
    'AT' = @{
        Name = 'Austria'
        TimeZone = 'W. Europe Standard Time'
        GeoId = 14  # Austria
        Culture = 'de-AT'
        Location = 'AT'
    }
    'IT' = @{
        Name = 'Italy'
        TimeZone = 'W. Europe Standard Time'
        GeoId = 118  # Italy
        Culture = 'it-IT'
        Location = 'IT'
    }
    'ES' = @{
        Name = 'Spain'
        TimeZone = 'Romance Standard Time'
        GeoId = 217  # Spain
        Culture = 'es-ES'
        Location = 'ES'
    }
    'SE' = @{
        Name = 'Sweden'
        TimeZone = 'W. Europe Standard Time'
        GeoId = 221  # Sweden
        Culture = 'sv-SE'
        Location = 'SE'
    }
    'NO' = @{
        Name = 'Norway'
        TimeZone = 'W. Europe Standard Time'
        GeoId = 177  # Norway
        Culture = 'nb-NO'
        Location = 'NO'
    }
    'DK' = @{
        Name = 'Denmark'
        TimeZone = 'Romance Standard Time'
        GeoId = 61  # Denmark
        Culture = 'da-DK'
        Location = 'DK'
    }
    'FI' = @{
        Name = 'Finland'
        TimeZone = 'FLE Standard Time'
        GeoId = 77  # Finland
        Culture = 'fi-FI'
        Location = 'FI'
    }
    'PL' = @{
        Name = 'Poland'
        TimeZone = 'Central European Standard Time'
        GeoId = 191  # Poland
        Culture = 'pl-PL'
        Location = 'PL'
    }
    'CZ' = @{
        Name = 'Czech Republic'
        TimeZone = 'Central Europe Standard Time'
        GeoId = 75  # Czech Republic
        Culture = 'cs-CZ'
        Location = 'CZ'
    }
    'IE' = @{
        Name = 'Ireland'
        TimeZone = 'GMT Standard Time'
        GeoId = 68  # Ireland
        Culture = 'en-IE'
        Location = 'IE'
    }
    'PT' = @{
        Name = 'Portugal'
        TimeZone = 'GMT Standard Time'
        GeoId = 193  # Portugal
        Culture = 'pt-PT'
        Location = 'PT'
    }
    'BR' = @{
        Name = 'Brazil'
        TimeZone = 'E. South America Standard Time'
        GeoId = 32  # Brazil
        Culture = 'pt-BR'
        Location = 'BR'
    }
    'MX' = @{
        Name = 'Mexico'
        TimeZone = 'Central Standard Time (Mexico)'
        GeoId = 166  # Mexico
        Culture = 'es-MX'
        Location = 'MX'
    }
    'CA' = @{
        Name = 'Canada'
        TimeZone = 'Eastern Standard Time'
        GeoId = 39  # Canada
        Culture = 'en-CA'
        Location = 'CA'
    }
    'NZ' = @{
        Name = 'New Zealand'
        TimeZone = 'New Zealand Standard Time'
        GeoId = 183  # New Zealand
        Culture = 'en-NZ'
        Location = 'NZ'
    }
}

#endregion

#region Main Execution

$StartTime = Get-Date
Write-Log "=== Windows 11 Regional Settings Configuration ==="
Write-Log "Country Code: $CountryCode" -Level Info
Write-Log "Execution Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Level Info

# Verify country code exists
if (-not $CountryConfig.ContainsKey($CountryCode)) {
    Write-Log "Country code '$CountryCode' not found in configuration database" -Level Error
    exit 1
}

$Config = $CountryConfig[$CountryCode]
Write-Log "Configuring for: $($Config.Name)" -Level Info

$Success = $true

# 1. Set Regional Format (Culture) - Date/Time/Currency/Number formats
Write-Log "Setting regional format to: $($Config.Culture)..." -Level Info
Write-Log "This configures: Date format, Time format, Currency, Number format" -Level Info
try {
    Set-Culture -CultureInfo $Config.Culture
    Write-Log "Regional format set to $($Config.Culture)" -Level Success
}
catch {
    Write-Log "Failed to set culture: $($_.Exception.Message)" -Level Error
    $Success = $false
}

# 2. Set Home Location (Geographic Location)
Write-Log "Setting geographic location to: $($Config.Name) (GeoId: $($Config.GeoId))..." -Level Info
try {
    Set-WinHomeLocation -GeoId $Config.GeoId
    Write-Log "Geographic location set to $($Config.Name)" -Level Success
}
catch {
    Write-Log "Failed to set home location: $($_.Exception.Message)" -Level Error
    $Success = $false
}

# 3. Set Time Zone
if ($SetTimeZone) {
    Write-Log "Setting time zone to: $($Config.TimeZone)..." -Level Info
    try {
        Set-TimeZone -Id $Config.TimeZone
        Write-Log "Time zone set to $($Config.TimeZone)" -Level Success
    }
    catch {
        Write-Log "Failed to set time zone: $($_.Exception.Message)" -Level Error
        $Success = $false
    }
}
else {
    Write-Log "Time zone configuration skipped (parameter)" -Level Warning
}

# 4. Set System Locale for non-Unicode programs
Write-Log "Setting system locale for non-Unicode programs..." -Level Info
try {
    Set-WinSystemLocale -SystemLocale $Config.Culture
    Write-Log "System locale set to $($Config.Culture)" -Level Success
}
catch {
    Write-Log "Failed to set system locale: $($_.Exception.Message)" -Level Error
    $Success = $false
}

# 5. Save configuration marker for detection
$MarkerPath = "HKLM:\SOFTWARE\AutopilotDeployment\Localization"
Set-RegistryValue -Path $MarkerPath -Name "CountryCode" -Value $CountryCode
Set-RegistryValue -Path $MarkerPath -Name "ConfiguredDate" -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Set-RegistryValue -Path $MarkerPath -Name "RegionalFormat" -Value $Config.Culture
Set-RegistryValue -Path $MarkerPath -Name "TimeZone" -Value $Config.TimeZone

# Summary
$Duration = (Get-Date) - $StartTime
Write-Log "`n=== Regional Settings Configuration Completed ==="
Write-Log "Country: $($Config.Name) ($CountryCode)" -Level Info
Write-Log "Regional Format: $($Config.Culture)" -Level Info
Write-Log "Time Zone: $($Config.TimeZone)" -Level Info
Write-Log "Display Language: Unchanged" -Level Info
Write-Log "Execution Time: $([Math]::Round($Duration.TotalSeconds, 2)) seconds" -Level Info
Write-Log "Status: $(if ($Success) { 'Success' } else { 'Completed with errors' })" -Level $(if ($Success) { 'Success' } else { 'Warning' })

# Important notes
Write-Log "`n=== Important Notes ==="
Write-Log "1. A system restart or logoff/logon recommended to apply all settings" -Level Warning
Write-Log "2. Regional formats (date/time/currency) configured for $($Config.Name)" -Level Info
Write-Log "3. Display language has NOT been changed" -Level Info
Write-Log "4. Keyboard layout has NOT been changed" -Level Info
Write-Log "5. Log file: $LogPath" -Level Info

if ($Success) {
    Write-Log "`nRegional settings configured successfully!" -Level Success
    exit 0
}
else {
    Write-Log "`nConfiguration completed with some errors. Check log for details." -Level Warning
    exit 1
}

#endregion
