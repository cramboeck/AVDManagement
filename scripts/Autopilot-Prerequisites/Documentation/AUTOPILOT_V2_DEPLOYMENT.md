# Autopilot v2 Deployment-Strategien

## Unterschied: Win32 App vs. Device Preparation Script

Bei Windows Autopilot v2 gibt es verschiedene Phasen und Deployment-Methoden:

### Device Preparation Phase (Früh im Prozess)
- **Wann:** Während der Device Preparation, BEVOR der Benutzer sich anmeldet
- **Methode:** PowerShell Scripts im Device Preparation Profile
- **Kontext:** Ausführung als SYSTEM
- **Zeitpunkt:** Sehr früh, vor Win32 Apps
- **Verwendung:** Prerequisites die andere Apps benötigen

### Application Installation Phase (Später im Prozess)
- **Wann:** Nach der Device Preparation, während/nach Benutzeranmeldung
- **Methode:** Win32 Apps (IntuneWin Packages)
- **Kontext:** SYSTEM oder USER
- **Zeitpunkt:** Nach Device Preparation Scripts
- **Verwendung:** Standard-Anwendungen

## Wann sollte was verwendet werden?

### ✅ Als Device Preparation Script verwenden:

**Szenarien:**
1. **Prerequisites für andere Apps:**
   - .NET Framework (wenn andere Apps es SOFORT benötigen)
   - Visual C++ Runtime (wenn andere Apps es SOFORT benötigen)
   - Registrierungs-Änderungen die vor Apps vorhanden sein müssen

2. **Sehr frühe Konfigurationen:**
   - Netzwerk-Einstellungen
   - Sicherheits-Einstellungen
   - Zertifikate für App-Installation

3. **Schnelle, kritische Änderungen:**
   - Kleine Scripts (<10 MB)
   - Kurze Laufzeit (<5 Minuten)

**Vorteile:**
- Sehr frühe Ausführung
- Garantiert vor Apps ausgeführt
- Schnellere Deployment-Zeit für nachfolgende Apps

**Nachteile:**
- Keine Detection Rules (läuft immer bei jedem Autopilot)
- Kein Retry-Mechanismus wie bei Win32 Apps
- Schwierigeres Troubleshooting

### ✅ Als Win32 App verwenden:

**Szenarien:**
1. **Prerequisites die nicht sofort benötigt werden:**
   - .NET Framework (wenn Apps es später brauchen)
   - Visual C++ Runtime (wenn Apps es später brauchen)
   - Optionale Komponenten

2. **Größere Installationen:**
   - Software >10 MB
   - Längere Installation >5 Minuten

3. **Wiederverwendbare Komponenten:**
   - Updates/Neu-Installationen später möglich
   - Detection Rules zur Vermeidung unnötiger Installs

**Vorteile:**
- Detection Rules (nur installieren wenn nötig)
- Besseres Monitoring in Intune
- Retry-Mechanismus
- Versionskontrolle

**Nachteile:**
- Später im Prozess
- Größerer Overhead

## Empfehlung für .NET Framework & VC++

### Option 1: Device Preparation Script (Empfohlen für Autopilot v2)

Wenn du sicherstellst dass ALLE nachfolgenden Apps sofort .NET/VC++ verfügbar haben:

**Setup in Intune:**

1. Gehe zu: **Devices** > **Enrollment** > **Device preparation policies**
2. Wähle dein Autopilot v2 Profile
3. Gehe zu: **Scripts**
4. Klicke: **Add** > **Windows**

**Script-Konfiguration:**

| Einstellung | Wert |
|-------------|------|
| **Name** | Install Prerequisites (.NET & VC++) |
| **Description** | Installiert .NET Framework 3.5, 4.8 und Visual C++ Redistributable |
| **Script file** | `Install-AutopilotSoftware.ps1` |
| **Run script in 64-bit PowerShell** | Yes |
| **Run script as user** | No (als SYSTEM) |
| **Enforce script signature check** | No |
| **Timeout (minutes)** | 30 |

**Wichtig:** Device Preparation Scripts haben KEINE Detection Rules. Das Script läuft bei jedem Autopilot-Durchlauf!

**Optimierung für Device Prep:**
```powershell
# Am Anfang von Install-AutopilotSoftware.ps1
# Schnelle Prüfung ob bereits installiert - wenn ja, sofort exit
$DotNet48 = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
$DotNet35 = Get-WindowsOptionalFeature -Online -FeatureName NetFx3 -ErrorAction SilentlyContinue
$VCRedist = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -like "*Visual C++*" }

if ($DotNet48.Release -ge 528040 -and $DotNet35.State -eq 'Enabled' -and $VCRedist) {
    Write-Host "Alle Prerequisites bereits installiert - überspringe"
    exit 0
}
```

### Option 2: Win32 App (Empfohlen für Standard-Deployments)

Wenn deine Apps .NET/VC++ nicht SOFORT benötigen oder du besseres Monitoring brauchst:

Verwende die bestehende Anleitung im README.md mit IntuneWin Package.

### Option 3: Hybrid-Ansatz (Best Practice für große Umgebungen)

**Szenario:** Einige Apps benötigen Prerequisites sofort, andere später.

1. **Device Preparation Script:**
   - Nur .NET Framework 3.5 (Windows Feature, schnell)
   - Kritische Registry-Einstellungen

2. **Win32 App (Erforderlich, hohe Priorität):**
   - .NET Framework 4.8 (größerer Download)
   - Visual C++ Redistributable
   - Mit Detection Rules

```powershell
# Device-Prep-Prerequisites.ps1 (nur .NET 3.5)
# Sehr schnell, nur Windows Feature aktivieren

$DotNet35 = Get-WindowsOptionalFeature -Online -FeatureName NetFx3 -ErrorAction SilentlyContinue

if ($DotNet35.State -ne 'Enabled') {
    Write-Host "Installiere .NET Framework 3.5..."
    Enable-WindowsOptionalFeature -Online -FeatureName NetFx3 -All -NoRestart -ErrorAction Stop
    Write-Host "Fertig"
}
else {
    Write-Host ".NET Framework 3.5 bereits installiert"
}

exit 0
```

## Schritt-für-Schritt: Device Preparation Script Setup

### 1. Script vorbereiten

Da Device Prep Scripts keine separate Detection haben, optimiere das Script:

**Install-AutopilotSoftware-DevicePrep.ps1:**
```powershell
<#
.SYNOPSIS
    Installiert Prerequisites während Autopilot Device Preparation

.NOTES
    - Läuft als SYSTEM
    - Keine Detection Rules (läuft bei jedem Autopilot)
    - Optimiert für schnelle Ausführung
#>

[CmdletBinding()]
param()

# Exit Codes
$ExitCode = 0

# Schnelle Prüfung ob bereits alles installiert ist
function Test-AllInstalled {
    $DotNet48 = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
    $DotNet35 = Get-WindowsOptionalFeature -Online -FeatureName NetFx3 -ErrorAction SilentlyContinue

    if ($DotNet48.Release -ge 528040 -and $DotNet35.State -eq 'Enabled') {
        # VC++ Prüfung
        $VCRedist_x64 = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -like "*Visual C++ 2015-2022*x64*" }
        $VCRedist_x86 = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -like "*Visual C++ 2015-2022*x86*" }

        if ($VCRedist_x64 -and $VCRedist_x86) {
            return $true
        }
    }

    return $false
}

# Schnellprüfung
if (Test-AllInstalled) {
    Write-Host "Alle Prerequisites bereits installiert - überspringe Installation"
    exit 0
}

Write-Host "Starte Prerequisites Installation..."

# Ab hier: Verwende den Inhalt von Install-AutopilotSoftware.ps1
# ... (restlicher Code)

exit $ExitCode
```

### 2. In Intune konfigurieren

**Intune Admin Center:**

1. **Devices** > **Enrollment** > **Device preparation policies**
2. Wähle/Erstelle dein Autopilot v2 Device Preparation Policy
3. **Scripts** > **Add** > **Windows**

**Einstellungen:**
```
Name: Install Autopilot Prerequisites
Description: Installiert .NET Framework 3.5, 4.8 und Visual C++ Redistributable
Script location: [Upload Install-AutopilotSoftware-DevicePrep.ps1]
Run this script using the logged-on credentials: No
Enforce script signature check: No
Run script in 64-bit PowerShell: Yes
```

### 3. Zuweisung

Weise das Device Preparation Profile der Autopilot Device Group zu.

## Monitoring und Troubleshooting

### Device Preparation Scripts Logs

**Intune Portal:**
1. **Devices** > **All devices** > [Gerät auswählen]
2. **Device preparation** > **Monitor** > **Scripts**

**Auf dem Gerät:**
```
C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\
```

Wichtige Logs:
- `IntuneManagementExtension.log`
- `DevicePreparationScript.log`

### Win32 App Logs

**Intune Portal:**
1. **Devices** > **All devices** > [Gerät auswählen]
2. **Managed Apps** > [App auswählen] > **Device install status**

**Auf dem Gerät:**
```
C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\
AgentExecutor.log
```

## Vergleichstabelle

| Feature | Device Prep Script | Win32 App |
|---------|-------------------|-----------|
| **Ausführungszeitpunkt** | Sehr früh | Später |
| **Detection Rules** | ❌ Nein | ✅ Ja |
| **Retry bei Fehler** | ⚠️ Begrenzt | ✅ Ja |
| **Monitoring** | ⚠️ Basic | ✅ Detailliert |
| **Updates** | ⚠️ Neu-Deployment | ✅ Einfach |
| **Max. Laufzeit** | ~30 Min | ~60 Min |
| **Datei-Größe** | Empfohlen <10 MB | Bis 30 GB |
| **Best für** | Prerequisites | Anwendungen |

## Empfehlung

**Für Prerequisites (.NET, VC++) bei Autopilot v2:**

1. **Kleine Umgebung (<50 Geräte):**
   - Win32 App mit IntuneWin Package
   - Einfacheres Management, besseres Monitoring

2. **Mittlere Umgebung (50-500 Geräte):**
   - Hybrid: .NET 3.5 als Device Prep Script
   - .NET 4.8 + VC++ als Win32 App

3. **Große Umgebung (>500 Geräte):**
   - Alle Prerequisites als Device Prep Script
   - Optimiert mit schneller Detection
   - Azure Blob Storage für Downloads

## Beispiel-Deployment

**Complete Autopilot v2 Setup:**

### Device Preparation Policy

**Scripts:**
1. **Install-Prerequisites.ps1** (Priority 1)
   - .NET Framework 3.5
   - Schnelle Konfiguration

2. **Configure-System.ps1** (Priority 2)
   - Registry-Einstellungen
   - Netzwerk-Konfiguration

### Win32 Apps (Required, High Priority)

1. **.NET Framework 4.8 & VC++ Redistributable**
   - Mit Detection Rules
   - Install Priority: 10 (sehr hoch)

2. **Company Portal**
   - Install Priority: 20

### Win32 Apps (Required, Normal Priority)

3. **Office 365**
   - Install Priority: 30

4. **LOB Apps**
   - Install Priority: 40+

---

**Wichtig:** Teste immer in einer Pilot-Gruppe bevor du auf alle Geräte ausrollst!
