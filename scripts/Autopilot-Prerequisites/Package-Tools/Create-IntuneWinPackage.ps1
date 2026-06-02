<#
.SYNOPSIS
    Erstellt ein IntuneWin-Package für die Autopilot Software Installation

.DESCRIPTION
    Dieses Script erstellt ein IntuneWin-Package mit dem Microsoft Win32 Content Prep Tool.
    Das Package enthält Scripts zur automatischen Installation von .NET Framework und Visual C++ Redistributable.

.PARAMETER DownloadContentPrepTool
    Lädt das Microsoft Win32 Content Prep Tool automatisch herunter, falls nicht vorhanden

.EXAMPLE
    .\Create-IntuneWinPackage.ps1
    Erstellt das IntuneWin-Package

.EXAMPLE
    .\Create-IntuneWinPackage.ps1 -DownloadContentPrepTool
    Lädt das Content Prep Tool herunter und erstellt das Package

.NOTES
    Filename: Create-IntuneWinPackage.ps1
    Author: PowerShell Automation
    Version: 1.0
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [switch]$DownloadContentPrepTool
)

$ErrorActionPreference = 'Stop'

# Pfade definieren
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceFolder = Join-Path -Path $ScriptRoot -ChildPath "SourceFiles"
$OutputFolder = Join-Path -Path $ScriptRoot -ChildPath "Output"
$ToolsFolder = Join-Path -Path $ScriptRoot -ChildPath "Tools"
$ContentPrepToolPath = Join-Path -Path $ToolsFolder -ChildPath "IntuneWinAppUtil.exe"

Write-Host "=== IntuneWin Package Erstellung ===" -ForegroundColor Cyan
Write-Host ""

# Erstelle Ordner falls nicht vorhanden
foreach ($Folder in @($SourceFolder, $OutputFolder, $ToolsFolder)) {
    if (-not (Test-Path $Folder)) {
        Write-Host "Erstelle Ordner: $Folder" -ForegroundColor Yellow
        New-Item -Path $Folder -ItemType Directory -Force | Out-Null
    }
}

# Prüfe ob Content Prep Tool existiert
if (-not (Test-Path $ContentPrepToolPath) -or $DownloadContentPrepTool) {
    Write-Host "Microsoft Win32 Content Prep Tool nicht gefunden. Lade herunter..." -ForegroundColor Yellow

    $ContentPrepUrl = "https://github.com/microsoft/Microsoft-Win32-Content-Prep-Tool/raw/master/IntuneWinAppUtil.exe"
    $TempZip = Join-Path -Path $ToolsFolder -ChildPath "IntuneWinAppUtil.exe"

    try {
        Write-Host "Download von: $ContentPrepUrl" -ForegroundColor Gray
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $ContentPrepUrl -OutFile $TempZip -UseBasicParsing
        $ProgressPreference = 'Continue'

        Write-Host "Download erfolgreich!" -ForegroundColor Green
    }
    catch {
        Write-Host "Fehler beim Download: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
        Write-Host "Bitte lade das Microsoft Win32 Content Prep Tool manuell herunter von:" -ForegroundColor Yellow
        Write-Host "https://github.com/microsoft/Microsoft-Win32-Content-Prep-Tool" -ForegroundColor Cyan
        Write-Host "Und speichere 'IntuneWinAppUtil.exe' in: $ToolsFolder" -ForegroundColor Yellow
        exit 1
    }
}

# Prüfe ob Source Files vorhanden sind
$InstallScript = Join-Path -Path $SourceFolder -ChildPath "Install-AutopilotSoftware.ps1"
$DetectScript = Join-Path -Path $SourceFolder -ChildPath "Detect-AutopilotSoftware.ps1"

if (-not (Test-Path $InstallScript)) {
    Write-Host "Fehler: Install-AutopilotSoftware.ps1 nicht in $SourceFolder gefunden!" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $DetectScript)) {
    Write-Host "Warnung: Detect-AutopilotSoftware.ps1 nicht in $SourceFolder gefunden!" -ForegroundColor Yellow
}

# Erstelle IntuneWin Package
Write-Host ""
Write-Host "Erstelle IntuneWin Package..." -ForegroundColor Cyan
Write-Host "  Source Folder: $SourceFolder" -ForegroundColor Gray
Write-Host "  Output Folder: $OutputFolder" -ForegroundColor Gray
Write-Host "  Setup File: Install-AutopilotSoftware.ps1" -ForegroundColor Gray
Write-Host ""

try {
    # IntuneWinAppUtil.exe Parameter:
    # -c <source_folder> = Quellordner mit den Dateien
    # -s <setup_file> = Setup-Datei (im Quellordner)
    # -o <output_folder> = Ausgabeordner für .intunewin Datei
    # -q = Quiet Mode (keine Interaktion)

    $Arguments = @(
        "-c", "`"$SourceFolder`"",
        "-s", "Install-AutopilotSoftware.ps1",
        "-o", "`"$OutputFolder`"",
        "-q"
    )

    Write-Host "Führe aus: IntuneWinAppUtil.exe $($Arguments -join ' ')" -ForegroundColor Gray
    Write-Host ""

    $Process = Start-Process -FilePath $ContentPrepToolPath -ArgumentList $Arguments -Wait -PassThru -NoNewWindow

    if ($Process.ExitCode -eq 0) {
        Write-Host ""
        Write-Host "=== Package erfolgreich erstellt! ===" -ForegroundColor Green
        Write-Host ""

        # Finde die erstellte .intunewin Datei
        $IntuneWinFile = Get-ChildItem -Path $OutputFolder -Filter "*.intunewin" | Select-Object -First 1

        if ($IntuneWinFile) {
            Write-Host "IntuneWin Datei: $($IntuneWinFile.FullName)" -ForegroundColor Cyan
            Write-Host "Dateigröße: $([Math]::Round($IntuneWinFile.Length / 1KB, 2)) KB" -ForegroundColor Gray
            Write-Host ""
            Write-Host "=== Nächste Schritte ===" -ForegroundColor Yellow
            Write-Host "1. Öffne das Microsoft Intune Admin Center (https://intune.microsoft.com)" -ForegroundColor White
            Write-Host "2. Navigiere zu: Apps > Windows > Hinzufügen" -ForegroundColor White
            Write-Host "3. Wähle 'Windows-App (Win32)'" -ForegroundColor White
            Write-Host "4. Lade die .intunewin Datei hoch" -ForegroundColor White
            Write-Host ""
            Write-Host "=== Empfohlene Einstellungen ===" -ForegroundColor Yellow
            Write-Host "Installationsbefehl:" -ForegroundColor White
            Write-Host "  powershell.exe -ExecutionPolicy Bypass -File Install-AutopilotSoftware.ps1" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Deinstallationsbefehl:" -ForegroundColor White
            Write-Host "  cmd.exe /c echo 'Keine Deinstallation erforderlich'" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Erkennungsregeln:" -ForegroundColor White
            Write-Host "  - Regeltyp: Benutzerdefiniertes Erkennungsskript verwenden" -ForegroundColor Cyan
            Write-Host "  - Skriptdatei: Detect-AutopilotSoftware.ps1" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Rückgabecodes:" -ForegroundColor White
            Write-Host "  - 0 = Erfolg" -ForegroundColor Cyan
            Write-Host "  - 3010 = Soft Reboot (Erfolg, Neustart erforderlich)" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Zuweisungen:" -ForegroundColor White
            Write-Host "  - Erforderlich: Gerätegruppe für Autopilot-Geräte" -ForegroundColor Cyan
            Write-Host "  - Filter: enrollmentProfileName -eq 'AutopilotV2'" -ForegroundColor Cyan
            Write-Host ""
        }
        else {
            Write-Host "Warnung: Keine .intunewin Datei im Ausgabeordner gefunden" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "Fehler beim Erstellen des Packages (Exit Code: $($Process.ExitCode))" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "Fehler: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Fertig! ===" -ForegroundColor Green
