<#
.SYNOPSIS
    Optimierte Installation von Software während des Autopilot v2 Prozesses

.DESCRIPTION
    Dieses Script nutzt Azure Blob Storage für schnelle Downloads mit Fallback
    auf Microsoft-Server. Optimiert für maximale Performance während Autopilot.

.NOTES
    Filename: Install-AutopilotSoftware-Optimized.ps1
    Author: PowerShell Automation
    Version: 2.0 (Optimized)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$AzureBlobStorageUrl = "",

    [Parameter(Mandatory = $false)]
    [string]$AzureBlobSasToken = ""
)

# Logging-Funktion
$LogPath = "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs"
$LogFile = "$LogPath\AutopilotSoftwareInstall_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

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

    switch ($Level) {
        'Error'   { Write-Host $LogEntry -ForegroundColor Red }
        'Warning' { Write-Host $LogEntry -ForegroundColor Yellow }
        'Success' { Write-Host $LogEntry -ForegroundColor Green }
        default   { Write-Host $LogEntry }
    }
}

# Optimierte Download-Funktion mit mehreren Quellen
function Get-FileWithFallback {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FileName,

        [Parameter(Mandatory = $true)]
        [string]$DestinationPath,

        [Parameter(Mandatory = $false)]
        [string]$AzureBlobUrl,

        [Parameter(Mandatory = $false)]
        [string]$SasToken,

        [Parameter(Mandatory = $true)]
        [string]$FallbackUrl
    )

    $DownloadSuccess = $false
    $Sources = @()

    # Priorität 1: Azure Blob Storage (falls konfiguriert)
    if (-not [string]::IsNullOrWhiteSpace($AzureBlobUrl)) {
        $AzureUrl = $AzureBlobUrl.TrimEnd('/') + "/" + $FileName

        if (-not [string]::IsNullOrWhiteSpace($SasToken)) {
            $AzureUrl += "?" + $SasToken.TrimStart('?')
        }

        $Sources += @{
            Name = "Azure Blob Storage"
            Url  = $AzureUrl
        }
    }

    # Priorität 2: Microsoft (Fallback)
    $Sources += @{
        Name = "Microsoft Download"
        Url  = $FallbackUrl
    }

    foreach ($Source in $Sources) {
        try {
            Write-Log "Versuche Download von: $($Source.Name)" -Level Info

            $StartTime = Get-Date
            $ProgressPreference = 'SilentlyContinue'

            Invoke-WebRequest -Uri $Source.Url -OutFile $DestinationPath -UseBasicParsing -TimeoutSec 300

            $ProgressPreference = 'Continue'
            $Duration = (Get-Date) - $StartTime

            if (Test-Path $DestinationPath) {
                $FileSizeMB = [Math]::Round((Get-Item $DestinationPath).Length / 1MB, 2)
                Write-Log "Download erfolgreich von $($Source.Name) ($FileSizeMB MB in $($Duration.TotalSeconds) Sekunden)" -Level Success
                $DownloadSuccess = $true
                break
            }
        }
        catch {
            Write-Log "Download von $($Source.Name) fehlgeschlagen: $($_.Exception.Message)" -Level Warning

            # Versuche nächste Quelle
            continue
        }
    }

    if (-not $DownloadSuccess) {
        Write-Log "Fehler: Datei konnte von keiner Quelle heruntergeladen werden" -Level Error
        return $false
    }

    return $true
}

# Temporärer Download-Ordner
$TempPath = "$env:TEMP\AutopilotSoftwareInstall"
if (-not (Test-Path $TempPath)) {
    New-Item -Path $TempPath -ItemType Directory -Force | Out-Null
}

Write-Log "=== Autopilot Software Installation (Optimized) gestartet ===" -Level Info

if (-not [string]::IsNullOrWhiteSpace($AzureBlobStorageUrl)) {
    Write-Log "Azure Blob Storage konfiguriert: $AzureBlobStorageUrl" -Level Info
}
else {
    Write-Log "Kein Azure Blob Storage konfiguriert, verwende Microsoft Download" -Level Info
}

#region .NET Framework 3.5 Installation
try {
    Write-Log "Überprüfe .NET Framework 3.5 Installation..." -Level Info

    # Prüfe ob .NET Framework 3.5 bereits installiert ist
    $DotNet35Feature = Get-WindowsOptionalFeature -Online -FeatureName NetFx3 -ErrorAction SilentlyContinue

    if ($null -eq $DotNet35Feature -or $DotNet35Feature.State -ne 'Enabled') {
        Write-Log ".NET Framework 3.5 nicht aktiviert. Starte Installation..." -Level Warning

        try {
            # DISM mit Windows Update (Empfohlen für Autopilot)
            Write-Log "Installiere .NET Framework 3.5 über Windows Update (DISM)..." -Level Info

            $DismArgs = @(
                "/Online",
                "/Enable-Feature",
                "/FeatureName:NetFx3",
                "/All",
                "/NoRestart",
                "/Quiet"
            )

            $DismLog = "$TempPath\DotNet35_DISM.log"
            $Process = Start-Process -FilePath "dism.exe" -ArgumentList $DismArgs -Wait -PassThru -NoNewWindow -RedirectStandardOutput $DismLog

            if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010) {
                Write-Log ".NET Framework 3.5 erfolgreich installiert (Exit Code: $($Process.ExitCode))" -Level Success

                if ($Process.ExitCode -eq 3010) {
                    Write-Log "Neustart erforderlich nach .NET 3.5 Installation" -Level Warning
                }
            }
            elseif ($Process.ExitCode -eq 1) {
                # Fehler, versuche alternative Methode
                Write-Log "DISM Installation fehlgeschlagen, versuche PowerShell Methode..." -Level Warning

                $EnableResult = Enable-WindowsOptionalFeature -Online -FeatureName NetFx3 -All -NoRestart -ErrorAction Stop

                if ($EnableResult.RestartNeeded) {
                    Write-Log ".NET Framework 3.5 installiert, Neustart erforderlich" -Level Warning
                }
                else {
                    Write-Log ".NET Framework 3.5 erfolgreich installiert" -Level Success
                }
            }
            else {
                Write-Log "Fehler bei .NET Framework 3.5 Installation (Exit Code: $($Process.ExitCode))" -Level Error

                if (Test-Path $DismLog) {
                    $LogContent = Get-Content $DismLog -Raw
                    Write-Log "DISM Log:`n$LogContent" -Level Error
                }
            }
        }
        catch {
            Write-Log "Fehler bei .NET Framework 3.5 Installation: $($_.Exception.Message)" -Level Error
        }
    }
    else {
        Write-Log ".NET Framework 3.5 ist bereits installiert und aktiviert" -Level Success
    }
}
catch {
    Write-Log "Fehler bei .NET Framework 3.5 Prüfung: $($_.Exception.Message)" -Level Error
}
#endregion

#region .NET Framework 4.8 Installation
try {
    Write-Log "Überprüfe .NET Framework Installation..." -Level Info

    # Prüfe ob .NET Framework 4.8 oder höher installiert ist
    $DotNetVersion = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue

    if ($null -eq $DotNetVersion -or $DotNetVersion.Release -lt 528040) {
        Write-Log ".NET Framework 4.8 nicht gefunden. Starte Download..." -Level Warning

        $DotNetInstaller = "$TempPath\ndp48-x86-x64-allos-enu.exe"

        # OPTION 1: Offline Installer (empfohlen für beste Performance)
        # Größe: ~116 MB, aber keine weitere Downloads während Installation
        $OfflineInstallerUrl = "https://go.microsoft.com/fwlink/?linkid=2088517"

        # OPTION 2: Web Installer (kleiner Download, aber lädt während Installation)
        # Größe: ~1.4 MB, aber lädt ~50 MB während Installation
        # $WebInstallerUrl = "https://go.microsoft.com/fwlink/?linkid=2088631"

        # Download mit Fallback
        $DownloadSuccess = Get-FileWithFallback `
            -FileName "ndp48-x86-x64-allos-enu.exe" `
            -DestinationPath $DotNetInstaller `
            -AzureBlobUrl $AzureBlobStorageUrl `
            -SasToken $AzureBlobSasToken `
            -FallbackUrl $OfflineInstallerUrl

        if ($DownloadSuccess) {
            Write-Log "Starte .NET Framework Installation..." -Level Info

            # Installiere .NET Framework
            # /q = Quiet (no UI)
            # /norestart = Don't restart automatically
            # /log = Log file location
            $InstallArgs = "/q /norestart /log `"$TempPath\DotNet48_Install.log`""
            $Process = Start-Process -FilePath $DotNetInstaller -ArgumentList $InstallArgs -Wait -PassThru -NoNewWindow

            if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010) {
                Write-Log ".NET Framework 4.8 erfolgreich installiert (Exit Code: $($Process.ExitCode))" -Level Success

                if ($Process.ExitCode -eq 3010) {
                    Write-Log "Neustart erforderlich nach .NET Installation" -Level Warning
                }
            }
            else {
                Write-Log "Fehler bei .NET Installation (Exit Code: $($Process.ExitCode))" -Level Error

                # Prüfe Installationslog
                $InstallLog = "$TempPath\DotNet48_Install.log"
                if (Test-Path $InstallLog) {
                    $LastLogLines = Get-Content $InstallLog -Tail 10 | Out-String
                    Write-Log "Letzte Zeilen aus Installationslog:`n$LastLogLines" -Level Error
                }
            }

            # Cleanup
            Remove-Item -Path $DotNetInstaller -Force -ErrorAction SilentlyContinue
        }
        else {
            Write-Log "Fehler beim Download von .NET Framework" -Level Error
        }
    }
    else {
        Write-Log ".NET Framework 4.8 oder höher ist bereits installiert (Release: $($DotNetVersion.Release))" -Level Success
    }
}
catch {
    Write-Log "Fehler bei .NET Framework Installation: $($_.Exception.Message)" -Level Error
}
#endregion

#region Visual C++ Redistributable Installation
try {
    Write-Log "Starte Visual C++ Redistributable Installation..." -Level Info

    # Download URLs für die neuesten VC++ Redistributables
    $VCRedistPackages = @(
        @{
            Name        = "Visual C++ 2015-2022 Redistributable (x64)"
            FileName    = "vc_redist.x64.exe"
            FallbackUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
            Arch        = "x64"
        },
        @{
            Name        = "Visual C++ 2015-2022 Redistributable (x86)"
            FileName    = "vc_redist.x86.exe"
            FallbackUrl = "https://aka.ms/vs/17/release/vc_redist.x86.exe"
            Arch        = "x86"
        }
    )

    foreach ($Package in $VCRedistPackages) {
        Write-Log "Verarbeite $($Package.Name)..." -Level Info

        $InstallerPath = "$TempPath\$($Package.FileName)"

        try {
            # Download mit Fallback
            $DownloadSuccess = Get-FileWithFallback `
                -FileName $Package.FileName `
                -DestinationPath $InstallerPath `
                -AzureBlobUrl $AzureBlobStorageUrl `
                -SasToken $AzureBlobSasToken `
                -FallbackUrl $Package.FallbackUrl

            if ($DownloadSuccess) {
                Write-Log "Starte Installation von $($Package.Name)..." -Level Info

                # Installiere VC++ Redistributable
                # /install = Install mode
                # /quiet = Quiet mode (no UI)
                # /norestart = Don't restart
                $InstallArgs = "/install /quiet /norestart"
                $Process = Start-Process -FilePath $InstallerPath -ArgumentList $InstallArgs -Wait -PassThru -NoNewWindow

                # Exit Codes:
                # 0 = Success
                # 3010 = Success, reboot required
                # 1638 = Already installed (newer version)
                if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010 -or $Process.ExitCode -eq 1638) {
                    Write-Log "$($Package.Name) erfolgreich installiert (Exit Code: $($Process.ExitCode))" -Level Success

                    if ($Process.ExitCode -eq 3010) {
                        Write-Log "Neustart erforderlich nach $($Package.Name) Installation" -Level Warning
                    }
                    elseif ($Process.ExitCode -eq 1638) {
                        Write-Log "$($Package.Name) - Neuere Version bereits installiert" -Level Info
                    }
                }
                else {
                    Write-Log "Fehler bei Installation von $($Package.Name) (Exit Code: $($Process.ExitCode))" -Level Error
                }

                # Cleanup
                Remove-Item -Path $InstallerPath -Force -ErrorAction SilentlyContinue
            }
            else {
                Write-Log "Fehler beim Download von $($Package.Name)" -Level Error
            }
        }
        catch {
            Write-Log "Fehler bei $($Package.Name): $($_.Exception.Message)" -Level Error
        }
    }
}
catch {
    Write-Log "Fehler bei Visual C++ Redistributable Installation: $($_.Exception.Message)" -Level Error
}
#endregion

# Cleanup temporärer Ordner
Write-Log "Bereinige temporäre Dateien..." -Level Info
try {
    Remove-Item -Path $TempPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log "Temporäre Dateien erfolgreich entfernt" -Level Info
}
catch {
    Write-Log "Warnung: Konnte temporäre Dateien nicht vollständig entfernen: $($_.Exception.Message)" -Level Warning
}

Write-Log "=== Autopilot Software Installation abgeschlossen ===" -Level Success
Write-Log "Logdatei: $LogFile" -Level Info

# Exit mit Erfolg
exit 0
