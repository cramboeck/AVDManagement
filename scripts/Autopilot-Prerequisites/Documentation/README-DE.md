# IntuneWin Autopilot Software Installation & CIS Hardening Package

This package enables automatic installation of required software and CIS security hardening during the Windows Autopilot v2 deployment process.

## Overview

The package provides:
- **Prerequisites Installation**: .NET Framework 3.5, .NET Framework 4.8, Visual C++ Redistributable (x64/x86)
- **CIS Hardening**: 100+ security settings based on CIS Windows 11 Benchmark
- **Multiple Deployment Options**: Win32 App, Device Preparation Script, or Intune Configuration Profiles
- **Performance Optimized**: Azure Blob Storage support, early detection, minimal overhead

## Languages

All scripts and documentation are available in English:
- `Install-AutopilotSoftware-EN.ps1` - English version
- `Detect-AutopilotSoftware-EN.ps1` - English detection
- `Apply-CISHardening-Win11.ps1` - CIS Benchmark hardening
- German versions available with `-DE` suffix (legacy)

## Contents

```
IntuneWin-AutopilotSoftware/
├── Create-IntuneWinPackage.ps1                    # Creates IntuneWin Package
├── SourceFiles/
│   ├── Install-AutopilotSoftware-EN.ps1           # English: Standard installation script (Win32 App)
│   ├── Install-AutopilotSoftware-Optimized.ps1    # With Azure Blob Storage support (Win32 App)
│   ├── Install-Prerequisites-DevicePrep.ps1       # Optimized for Device Preparation
│   ├── Apply-CISHardening-Win11.ps1               # CIS Windows 11 Benchmark hardening
│   ├── Detect-AutopilotSoftware-EN.ps1            # Detection script (for Win32 Apps)
│   └── [Legacy German versions with -DE suffix]
├── Output/                                         # Output folder for .intunewin file
├── Tools/                                          # Microsoft Win32 Content Prep Tool
├── README.md                                       # This file
├── AUTOPILOT_V2_DEPLOYMENT.md                     # Device Prep vs Win32 App Guide
├── AZURE_BLOB_SETUP.md                            # Azure Blob Storage Setup Guide
└── CIS_HARDENING_GUIDE.md                         # CIS Windows 11 Hardening Guide
```

## Script Versions

### 1. Prerequisites Installation Scripts

#### Install-AutopilotSoftware-EN.ps1 (Standard)
- Downloads software directly from Microsoft
- No additional configuration required
- **Recommended for:** Win32 App deployment, small environments (<100 devices)

#### Install-AutopilotSoftware-Optimized.ps1 (Performance)
- Supports Azure Blob Storage for faster downloads
- Fallback to Microsoft download
- Parameters for Azure Blob URL and SAS Token
- **Recommended for:** Win32 App deployment, medium to large environments (100+ devices)
- **See:** [AZURE_BLOB_SETUP.md](AZURE_BLOB_SETUP.md) for setup instructions

#### Install-Prerequisites-DevicePrep.ps1 (Device Preparation)
- Optimized for Autopilot v2 Device Preparation Scripts
- Fast detection at start (skips if already installed)
- Minimal logging for better performance
- **Recommended for:** Autopilot v2 Device Preparation phase
- **See:** [AUTOPILOT_V2_DEPLOYMENT.md](AUTOPILOT_V2_DEPLOYMENT.md) for details

### 2. Security Hardening Script

#### Apply-CISHardening-Win11.ps1 (NEW!)
- Applies 100+ CIS Windows 11 Benchmark security settings
- Supports Level 1 (essential) and Level 2 (high security)
- Categories: Password Policy, Account Lockout, UAC, Firewall, Defender, SMB, RDP, Audit Policies
- **Recommended for:** All environments to establish security baseline
- **See:** [CIS_HARDENING_GUIDE.md](CIS_HARDENING_GUIDE.md) for complete documentation

## Deployment Methods

**Important:** There are multiple approaches for deployment during Autopilot v2:

### 1. Win32 App (IntuneWin Package)
✅ Better monitoring and management
✅ Detection rules prevent unnecessary installations
✅ Retry mechanism on failures
✅ Version control and updates
**See:** Instructions below in this README

### 2. Device Preparation Script
✅ Very early execution (before other apps)
✅ Prerequisites guaranteed available before apps
✅ Optimized for fast execution
✅ Ideal for security hardening
**See:** [AUTOPILOT_V2_DEPLOYMENT.md](AUTOPILOT_V2_DEPLOYMENT.md) for complete guide

### 3. Intune Configuration Profiles
✅ Ongoing compliance monitoring
✅ Built-in reporting and remediation
✅ Integration with Conditional Access
**See:** [CIS_HARDENING_GUIDE.md](CIS_HARDENING_GUIDE.md) Section "Complementary Intune Configuration Profiles"

## Quick Start

### Option A: Prerequisites Only (Win32 App)

```powershell
# 1. Navigate to script folder
cd scripts/IntuneWin-AutopilotSoftware

# 2. Create IntuneWin package (auto-downloads Content Prep Tool)
.\Create-IntuneWinPackage.ps1 -DownloadContentPrepTool

# 3. Upload to Intune (see detailed instructions below)
```

### Option B: Prerequisites + CIS Hardening (Device Preparation)

```powershell
# Use both scripts in Autopilot Device Preparation profile:

# Script 1 (Priority 1): Install prerequisites
.\Install-Prerequisites-DevicePrep.ps1

# Script 2 (Priority 2): Apply CIS hardening
.\Apply-CISHardening-Win11.ps1 -Level 1

# Or Level 2 for high security environments
.\Apply-CISHardening-Win11.ps1 -Level 2
```

### Option C: Hybrid Approach (Recommended for Enterprise)

```
1. Device Preparation: CIS Hardening (Level 1) → Security baseline from start
2. Win32 App: Prerequisites Installation → Better monitoring
3. Intune Config Profiles: Password Policy, BitLocker → Ongoing compliance
4. Compliance Policies: Check and enforce → Conditional Access
```

**Recommendation:** Read [AUTOPILOT_V2_DEPLOYMENT.md](AUTOPILOT_V2_DEPLOYMENT.md) and [CIS_HARDENING_GUIDE.md](CIS_HARDENING_GUIDE.md) to determine the best approach for your environment.
```

## Prerequisites

- PowerShell 5.1 or higher
- Administrator rights (not required for package creation)
- Internet access (for software downloads during installation)
- Microsoft Intune license
- Access to Microsoft Intune Admin Center
- Windows 10 1607 or higher (target devices)
- Windows 11 23H2 (for CIS hardening script)

## Schnellstart

### 1. IntuneWin Package erstellen

```powershell
# Navigiere zum Script-Ordner
cd scripts/IntuneWin-AutopilotSoftware

# Erstelle das Package (lädt automatisch das Content Prep Tool herunter)
.\Create-IntuneWinPackage.ps1 -DownloadContentPrepTool
```

Das Script erstellt automatisch:
- Alle erforderlichen Ordner
- Lädt das Microsoft Win32 Content Prep Tool herunter
- Erstellt die `.intunewin` Datei im `Output` Ordner

### 2. Package in Intune hochladen

1. Öffne das [Microsoft Intune Admin Center](https://intune.microsoft.com)
2. Navigiere zu: **Apps** > **Windows** > **Hinzufügen**
3. Wähle **Windows-App (Win32)**
4. Klicke auf **App-Paketdatei auswählen**
5. Wähle die `.intunewin` Datei aus dem `Output` Ordner

### 3. App-Informationen konfigurieren

**Pflichtfelder:**
- **Name:** Autopilot Software Installation (DotNet & VC++)
- **Beschreibung:** Installiert automatisch .NET Framework 4.8 und Visual C++ Redistributable während des Autopilot-Prozesses
- **Herausgeber:** IT-Abteilung
- **Kategorie:** Entwicklertools (oder eigene Kategorie)

### 4. Programm konfigurieren

**Installationsbefehl:**
```powershell
powershell.exe -ExecutionPolicy Bypass -File Install-AutopilotSoftware.ps1
```

**Deinstallationsbefehl:**
```cmd
cmd.exe /c echo Keine Deinstallation erforderlich
```

**Installationsverhalten:** System

**Geräteneustartverhalten:** Intune bestimmt das Verhalten anhand der Rückgabecodes

### 5. Anforderungen konfigurieren

**Betriebssystem:**
- Mindestens: Windows 10 1607 (oder höher)
- Architektur: 64-Bit

**Festplattenspeicher:** 500 MB (für Downloads während der Installation)

**Physischer Speicher:** 512 MB

### 6. Erkennungsregeln konfigurieren

**Regeltyp:** Benutzerdefiniertes Erkennungsskript verwenden

**Skriptdatei:** `Detect-AutopilotSoftware.ps1`

**Skript als 32-Bit-Prozess auf 64-Bit-Clients ausführen:** Nein

**Skriptsignaturprüfung und 64-Bit-PowerShell erzwingen:** Nein

### 7. Rückgabecodes

Die Standardrückgabecodes sollten korrekt sein:

| Code | Typ | Beschreibung |
|------|-----|--------------|
| 0 | Erfolg | Installation erfolgreich |
| 3010 | Soft Reboot | Installation erfolgreich, Neustart erforderlich |
| 1638 | Bereits installiert | Neuere Version bereits vorhanden |
| 1 | Fehler | Installationsfehler |

### 8. Zuweisungen konfigurieren

**Erforderlich:**
- Wähle die Gerätegruppe für Autopilot-Geräte
- Optional: Füge einen Filter hinzu für Autopilot v2 Profile

**Beispiel-Filter:**
```
(device.enrollmentProfileName -eq "AutopilotV2Profile")
```

**Zeitplan:**
- Sobald wie möglich verfügbar machen: Ja
- Bei Frist: Sobald wie möglich

## Funktionsweise

### Installation

1. **Logging:** Alle Aktivitäten werden protokolliert unter:
   ```
   C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\
   AutopilotSoftwareInstall_<Timestamp>.log
   ```

2. **.NET Framework 3.5:**
   - Prüft ob .NET Framework 3.5 bereits aktiviert ist
   - Aktiviert das Windows Feature via DISM
   - Fallback auf PowerShell Enable-WindowsOptionalFeature
   - Verwendet Windows Update als Quelle (benötigt Internet)

3. **.NET Framework 4.8:**
   - Prüft ob .NET Framework 4.8 oder höher installiert ist
   - Lädt bei Bedarf den Installer von Microsoft herunter
   - Installiert im Silent-Modus
   - Standard: Web-Installer (~1.4 MB, lädt während Installation)
   - Optional: Offline-Installer (~116 MB, keine weiteren Downloads)

4. **Visual C++ Redistributable:**
   - Lädt die neuesten x64 und x86 Versionen herunter
   - Installiert beide Versionen im Silent-Modus
   - Überspringt bereits installierte neuere Versionen

### Erkennung

Das Detection-Script prüft:
- Registry-Schlüssel für .NET Framework 4.8 (Release >= 528040)
- Installierte Programme nach Visual C++ 2015-2022 Redistributable (x64 und x86)

**Exit Codes:**
- `0` = Alle Komponenten installiert (keine Installation nötig)
- `1` = Komponenten fehlen (Installation erforderlich)

## Anpassung

### Weitere Software hinzufügen

1. Öffne `SourceFiles/Install-AutopilotSoftware.ps1`
2. Füge einen neuen Region-Block hinzu:

```powershell
#region Meine Software Installation
try {
    Write-Log "Installiere Meine Software..." -Level Info

    $DownloadUrl = "https://example.com/software.exe"
    $Installer = "$TempPath\software.exe"

    # Download
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $Installer -UseBasicParsing

    # Installation
    $Process = Start-Process -FilePath $Installer -ArgumentList "/silent" -Wait -PassThru -NoNewWindow

    if ($Process.ExitCode -eq 0) {
        Write-Log "Installation erfolgreich" -Level Success
    }
}
catch {
    Write-Log "Fehler: $($_.Exception.Message)" -Level Error
}
#endregion
```

3. Aktualisiere das Detection-Script entsprechend
4. Erstelle das Package neu

### Download-URLs aktualisieren

Die Scripts verwenden automatisch die neuesten URLs:

- **.NET Framework 4.8:**
  ```
  https://go.microsoft.com/fwlink/?linkid=2088631
  ```

- **Visual C++ Redistributable:**
  ```
  https://aka.ms/vs/17/release/vc_redist.x64.exe
  https://aka.ms/vs/17/release/vc_redist.x86.exe
  ```

Diese Links zeigen immer auf die neuesten Versionen von Microsoft.

## Troubleshooting

### Package-Erstellung schlägt fehl

**Problem:** Content Prep Tool nicht gefunden

**Lösung:**
```powershell
.\Create-IntuneWinPackage.ps1 -DownloadContentPrepTool
```

### Installation schlägt fehl

**Problem:** Download-Fehler

**Überprüfung:**
1. Internetverbindung während Installation vorhanden?
2. Proxy-Einstellungen korrekt?
3. Firewall blockiert Downloads?

**Logdatei prüfen:**
```powershell
# Auf dem Zielgerät
Get-Content "C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\AutopilotSoftwareInstall_*.log"
```

### Detection schlägt fehl

**Problem:** Software wird nicht erkannt, obwohl installiert

**Überprüfung auf Zielgerät:**
```powershell
# .NET Framework prüfen
Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full'

# VC++ Redistributable prüfen
Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' |
    Where-Object { $_.DisplayName -like "*Visual C++*" } |
    Select-Object DisplayName, DisplayVersion
```

### Installation dauert zu lange

**Problem:** Timeout während Autopilot

**Lösung:**
- Erhöhe das Installationstimeout in Intune (Standard: 60 Minuten)
- Verwende den Offline-Installer für .NET statt Web-Installer

**Offline-Installer verwenden:**
Ändere in `Install-AutopilotSoftware.ps1`:
```powershell
# Alt:
$DotNetUrl = "https://go.microsoft.com/fwlink/?linkid=2088631"

# Neu (Offline, ~116 MB):
$DotNetUrl = "https://go.microsoft.com/fwlink/?linkid=2088517"
```

## Best Practices

1. **Testen:** Teste das Package zuerst auf einem Test-Gerät
2. **Phasenweise Einführung:** Starte mit einer kleinen Pilotgruppe
3. **Monitoring:** Überwache die Installation in Intune regelmäßig
4. **Updates:** Überprüfe regelmäßig, ob neuere Versionen verfügbar sind
5. **Dokumentation:** Dokumentiere Anpassungen für dein Team

## Support

### Intune Management Extension Logs

```
C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\
```

Wichtige Logdateien:
- `IntuneManagementExtension.log` - Hauptlog
- `AgentExecutor.log` - App-Installation
- `AutopilotSoftwareInstall_*.log` - Unser Custom Log

### Weitere Ressourcen

- [Microsoft Intune Dokumentation](https://docs.microsoft.com/intune/)
- [Win32 App Management](https://docs.microsoft.com/mem/intune/apps/apps-win32-app-management)
- [Windows Autopilot](https://docs.microsoft.com/mem/autopilot/)
- [.NET Framework Download](https://dotnet.microsoft.com/download/dotnet-framework)
- [Visual C++ Downloads](https://docs.microsoft.com/cpp/windows/latest-supported-vc-redist)

## Lizenz

Dieses Script ist Teil des PowerShell Management Repository und unterliegt den gleichen Lizenzbedingungen.

## Changelog

### Version 1.0 (2025-10-25)
- Initiale Version
- Automatische Installation von .NET Framework 4.8
- Automatische Installation von Visual C++ Redistributable 2015-2022
- Umfassendes Logging
- Detection Script
- Dokumentation

---

**Hinweis:** Diese Scripts dienen als Grundlage und können an spezifische Unternehmensanforderungen angepasst werden.
