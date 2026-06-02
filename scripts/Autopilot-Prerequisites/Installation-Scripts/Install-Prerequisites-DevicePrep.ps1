<#
.SYNOPSIS
    Installiert Prerequisites während Autopilot Device Preparation Phase

.DESCRIPTION
    Dieses Script ist optimiert für die Verwendung als Device Preparation Script
    in Autopilot v2. Es führt eine schnelle Prüfung durch und überspringt die
    Installation wenn bereits alles vorhanden ist.

    Installiert:
    - .NET Framework 3.5 (Windows Feature)
    - .NET Framework 4.8
    - Visual C++ Redistributable 2015-2022 (x64 und x86)

.NOTES
    Filename: Install-Prerequisites-DevicePrep.ps1
    Author: PowerShell Automation
    Version: 1.0
    Context: Läuft als SYSTEM
    Verwendung: Autopilot v2 Device Preparation Script

    WICHTIG:
    - Device Prep Scripts haben KEINE Detection Rules
    - Script läuft bei JEDEM Autopilot-Durchlauf
    - Daher ist schnelle Detection am Anfang kritisch
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$VerbosePreference = 'Continue'

# Exit Code
$ExitCode = 0

# Logging
$LogPath = "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs"
$LogFile = "$LogPath\DevicePrep_Prerequisites_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

if (-not (Test-Path $LogPath)) {
    New-Item -Path $LogPath -ItemType Directory -Force | Out-Null
}

function Write-Log {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [Parameter(Mandatory = $false)]
        [ValidateSet('Info', 'Warning', 'Error', 'Success')]
        [string]$Level = 'Info'
    )

    $Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $LogEntry = "[$Timestamp] [$Level] $Message"

    Add-Content -Path $LogFile -Value $LogEntry
    Write-Host $LogEntry
}

# Schnelle Detection-Funktion
function Test-AllPrerequisitesInstalled {
    Write-Log "Prüfe ob Prerequisites bereits installiert sind..." -Level Info

    # Prüfe .NET Framework 3.5
    $DotNet35 = Get-WindowsOptionalFeature -Online -FeatureName NetFx3 -ErrorAction SilentlyContinue
    if ($null -eq $DotNet35 -or $DotNet35.State -ne 'Enabled') {
        Write-Log ".NET Framework 3.5 nicht installiert" -Level Info
        return $false
    }

    # Prüfe .NET Framework 4.8
    $DotNet48 = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
    if ($null -eq $DotNet48 -or $DotNet48.Release -lt 528040) {
        Write-Log ".NET Framework 4.8 nicht installiert" -Level Info
        return $false
    }

    # Prüfe Visual C++ Redistributable
    $AllApps = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
                                        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue

    $VCRedist_x64 = $AllApps | Where-Object { $_.DisplayName -like "*Visual C++ 2015-2022 Redistributable*x64*" }
    $VCRedist_x86 = $AllApps | Where-Object { $_.DisplayName -like "*Visual C++ 2015-2022 Redistributable*x86*" }

    if ($null -eq $VCRedist_x64 -or $null -eq $VCRedist_x86) {
        Write-Log "Visual C++ Redistributable nicht vollständig installiert" -Level Info
        return $false
    }

    Write-Log "Alle Prerequisites bereits installiert" -Level Success
    return $true
}

Write-Log "=== Autopilot Device Preparation: Prerequisites Installation ===" -Level Info
Write-Log "Script Version: 1.0" -Level Info
Write-Log "Execution Context: SYSTEM" -Level Info

# SCHNELLPRÜFUNG - Kritisch für Device Prep Scripts
if (Test-AllPrerequisitesInstalled) {
    Write-Log "Alle Prerequisites bereits vorhanden - Installation wird übersprungen" -Level Success
    Write-Log "Gesamtdauer: 0 Sekunden (Skip)" -Level Info
    exit 0
}

$StartTime = Get-Date
Write-Log "Nicht alle Prerequisites vorhanden - starte Installation..." -Level Warning

# Temporärer Ordner
$TempPath = "$env:TEMP\DevicePrepPrerequisites"
if (-not (Test-Path $TempPath)) {
    New-Item -Path $TempPath -ItemType Directory -Force | Out-Null
}

#region .NET Framework 3.5 Installation
Write-Log "--- .NET Framework 3.5 Installation ---" -Level Info

try {
    $DotNet35 = Get-WindowsOptionalFeature -Online -FeatureName NetFx3 -ErrorAction SilentlyContinue

    if ($null -eq $DotNet35 -or $DotNet35.State -ne 'Enabled') {
        Write-Log "Installiere .NET Framework 3.5 via DISM..." -Level Info

        $DismArgs = @(
            "/Online",
            "/Enable-Feature",
            "/FeatureName:NetFx3",
            "/All",
            "/NoRestart",
            "/Quiet"
        )

        $Process = Start-Process -FilePath "dism.exe" -ArgumentList $DismArgs -Wait -PassThru -NoNewWindow

        if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010) {
            Write-Log ".NET Framework 3.5 erfolgreich installiert" -Level Success
        }
        else {
            Write-Log "DISM fehlgeschlagen (Exit Code: $($Process.ExitCode)), versuche PowerShell Methode..." -Level Warning

            $EnableResult = Enable-WindowsOptionalFeature -Online -FeatureName NetFx3 -All -NoRestart -ErrorAction Stop
            Write-Log ".NET Framework 3.5 über PowerShell installiert" -Level Success
        }
    }
    else {
        Write-Log ".NET Framework 3.5 bereits installiert" -Level Info
    }
}
catch {
    Write-Log "Fehler bei .NET Framework 3.5: $($_.Exception.Message)" -Level Error
    $ExitCode = 1
}
#endregion

#region .NET Framework 4.8 Installation
Write-Log "--- .NET Framework 4.8 Installation ---" -Level Info

try {
    $DotNet48 = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue

    if ($null -eq $DotNet48 -or $DotNet48.Release -lt 528040) {
        Write-Log "Lade .NET Framework 4.8 herunter..." -Level Info

        # Verwende Offline Installer für bessere Performance
        $DotNetUrl = "https://go.microsoft.com/fwlink/?linkid=2088517"
        $DotNetInstaller = "$TempPath\ndp48-x86-x64-allos-enu.exe"

        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $DotNetUrl -OutFile $DotNetInstaller -UseBasicParsing -TimeoutSec 300
        $ProgressPreference = 'Continue'

        if (Test-Path $DotNetInstaller) {
            Write-Log "Download abgeschlossen. Starte Installation..." -Level Info

            $InstallArgs = "/q /norestart"
            $Process = Start-Process -FilePath $DotNetInstaller -ArgumentList $InstallArgs -Wait -PassThru -NoNewWindow

            if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010) {
                Write-Log ".NET Framework 4.8 erfolgreich installiert (Exit Code: $($Process.ExitCode))" -Level Success
            }
            else {
                Write-Log "Installation fehlgeschlagen (Exit Code: $($Process.ExitCode))" -Level Error
                $ExitCode = 1
            }

            Remove-Item -Path $DotNetInstaller -Force -ErrorAction SilentlyContinue
        }
        else {
            Write-Log "Download fehlgeschlagen" -Level Error
            $ExitCode = 1
        }
    }
    else {
        Write-Log ".NET Framework 4.8 oder höher bereits installiert (Release: $($DotNet48.Release))" -Level Info
    }
}
catch {
    Write-Log "Fehler bei .NET Framework 4.8: $($_.Exception.Message)" -Level Error
    $ExitCode = 1
}
#endregion

#region Visual C++ Redistributable Installation
Write-Log "--- Visual C++ Redistributable Installation ---" -Level Info

$VCRedistPackages = @(
    @{
        Name = "Visual C++ 2015-2022 Redistributable (x64)"
        Url  = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
        File = "vc_redist.x64.exe"
    },
    @{
        Name = "Visual C++ 2015-2022 Redistributable (x86)"
        Url  = "https://aka.ms/vs/17/release/vc_redist.x86.exe"
        File = "vc_redist.x86.exe"
    }
)

foreach ($Package in $VCRedistPackages) {
    try {
        Write-Log "Lade $($Package.Name) herunter..." -Level Info

        $InstallerPath = "$TempPath\$($Package.File)"

        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $Package.Url -OutFile $InstallerPath -UseBasicParsing -TimeoutSec 180
        $ProgressPreference = 'Continue'

        if (Test-Path $InstallerPath) {
            Write-Log "Installiere $($Package.Name)..." -Level Info

            $InstallArgs = "/install /quiet /norestart"
            $Process = Start-Process -FilePath $InstallerPath -ArgumentList $InstallArgs -Wait -PassThru -NoNewWindow

            if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010 -or $Process.ExitCode -eq 1638) {
                Write-Log "$($Package.Name) erfolgreich installiert (Exit Code: $($Process.ExitCode))" -Level Success
            }
            else {
                Write-Log "$($Package.Name) Installation fehlgeschlagen (Exit Code: $($Process.ExitCode))" -Level Error
                $ExitCode = 1
            }

            Remove-Item -Path $InstallerPath -Force -ErrorAction SilentlyContinue
        }
        else {
            Write-Log "Download von $($Package.Name) fehlgeschlagen" -Level Error
            $ExitCode = 1
        }
    }
    catch {
        Write-Log "Fehler bei $($Package.Name): $($_.Exception.Message)" -Level Error
        $ExitCode = 1
    }
}
#endregion

# Cleanup
try {
    Remove-Item -Path $TempPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log "Temporäre Dateien bereinigt" -Level Info
}
catch {
    Write-Log "Warnung: Cleanup fehlgeschlagen: $($_.Exception.Message)" -Level Warning
}

# Zusammenfassung
$Duration = (Get-Date) - $StartTime
Write-Log "=== Installation abgeschlossen ===" -Level Info
Write-Log "Gesamtdauer: $([Math]::Round($Duration.TotalMinutes, 2)) Minuten" -Level Info
Write-Log "Exit Code: $ExitCode" -Level Info
Write-Log "Logdatei: $LogFile" -Level Info

if ($ExitCode -eq 0) {
    Write-Log "Status: Erfolgreich" -Level Success
}
else {
    Write-Log "Status: Mit Fehlern abgeschlossen" -Level Error
}

exit $ExitCode
