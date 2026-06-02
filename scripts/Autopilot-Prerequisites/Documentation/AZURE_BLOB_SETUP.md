# Azure Blob Storage Setup für optimierte Autopilot Installation

Diese Anleitung erklärt, wie du Azure Blob Storage für schnellere Downloads während des Autopilot-Prozesses einrichtest.

## Warum Azure Blob Storage?

**Performance-Vergleich:**

| Methode | Download-Zeit (.NET 4.8 Offline) | Vorteile | Nachteile |
|---------|----------------------------------|----------|-----------|
| **Azure Blob Storage** | ~10-30 Sekunden | Schnellste Option, Azure-internes Netzwerk, CDN | Wartungsaufwand, Kosten |
| **Microsoft Download** | ~30-90 Sekunden | Keine zusätzliche Infrastruktur | Langsamer, abhängig von Region |
| **Direkt im Package** | 0 Sekunden (kein Download) | Keine Netzwerkabhängigkeit | Sehr große .intunewin Datei |

## Setup-Schritte

### 1. Azure Storage Account erstellen

```powershell
# Mit Azure PowerShell
Connect-AzAccount

# Variablen setzen
$ResourceGroupName = "rg-intune-autopilot"
$Location = "westeurope"  # Wähle die Region deiner Geräte
$StorageAccountName = "saintuneautopilot"  # Muss global eindeutig sein (nur Kleinbuchstaben, Zahlen)

# Resource Group erstellen
New-AzResourceGroup -Name $ResourceGroupName -Location $Location

# Storage Account erstellen
New-AzStorageAccount `
    -ResourceGroupName $ResourceGroupName `
    -Name $StorageAccountName `
    -Location $Location `
    -SkuName Standard_LRS `
    -Kind StorageV2 `
    -AccessTier Hot `
    -AllowBlobPublicAccess $false
```

### 2. Blob Container erstellen

```powershell
# Storage Context holen
$StorageAccount = Get-AzStorageAccount -ResourceGroupName $ResourceGroupName -Name $StorageAccountName
$Context = $StorageAccount.Context

# Container erstellen
$ContainerName = "autopilot-software"
New-AzStorageContainer -Name $ContainerName -Context $Context -Permission Off
```

### 3. Software-Dateien hochladen

```powershell
# Download-Ordner erstellen
$DownloadPath = "$env:TEMP\AutopilotSoftware"
New-Item -Path $DownloadPath -ItemType Directory -Force

# .NET Framework 4.8 Offline Installer herunterladen (~116 MB)
$DotNet48Url = "https://go.microsoft.com/fwlink/?linkid=2088517"
$DotNet48File = "$DownloadPath\ndp48-x86-x64-allos-enu.exe"
Invoke-WebRequest -Uri $DotNet48Url -OutFile $DotNet48File

# Visual C++ Redistributable herunterladen
$VCRedist_x64_Url = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
$VCRedist_x86_Url = "https://aka.ms/vs/17/release/vc_redist.x86.exe"

Invoke-WebRequest -Uri $VCRedist_x64_Url -OutFile "$DownloadPath\vc_redist.x64.exe"
Invoke-WebRequest -Uri $VCRedist_x86_Url -OutFile "$DownloadPath\vc_redist.x86.exe"

# Dateien zu Azure Blob Storage hochladen
Get-ChildItem -Path $DownloadPath -File | ForEach-Object {
    Write-Host "Lade hoch: $($_.Name)" -ForegroundColor Green

    Set-AzStorageBlobContent `
        -File $_.FullName `
        -Container $ContainerName `
        -Blob $_.Name `
        -Context $Context `
        -Force
}

Write-Host "Upload abgeschlossen!" -ForegroundColor Green
```

### 4. SAS Token generieren

**Option A: Mit Ablaufdatum (Empfohlen)**

```powershell
# SAS Token für 1 Jahr generieren
$StartTime = Get-Date
$ExpiryTime = $StartTime.AddYears(1)

$SasToken = New-AzStorageContainerSASToken `
    -Name $ContainerName `
    -Context $Context `
    -Permission r `
    -StartTime $StartTime `
    -ExpiryTime $ExpiryTime

Write-Host "SAS Token:" -ForegroundColor Cyan
Write-Host $SasToken
```

**Option B: Mit Stored Access Policy (Best Practice)**

```powershell
# Access Policy erstellen (kann später aktualisiert werden)
$PolicyName = "AutopilotReadPolicy"

New-AzStorageContainerStoredAccessPolicy `
    -Container $ContainerName `
    -Policy $PolicyName `
    -Context $Context `
    -Permission r `
    -ExpiryTime (Get-Date).AddYears(5)

# SAS Token basierend auf Policy generieren
$SasToken = New-AzStorageContainerSASToken `
    -Name $ContainerName `
    -Policy $PolicyName `
    -Context $Context

Write-Host "SAS Token mit Access Policy:" -ForegroundColor Cyan
Write-Host $SasToken
```

### 5. Blob URL ermitteln

```powershell
# Base URL für den Container
$BlobBaseUrl = "$($StorageAccount.PrimaryEndpoints.Blob)$ContainerName"

Write-Host ""
Write-Host "=== Konfiguration für Intune Script ===" -ForegroundColor Yellow
Write-Host "Blob Storage URL: $BlobBaseUrl" -ForegroundColor Cyan
Write-Host "SAS Token: $SasToken" -ForegroundColor Cyan
Write-Host ""
Write-Host "Beispiel-URLs:" -ForegroundColor Yellow
Write-Host "  .NET Framework: $BlobBaseUrl/ndp48-x86-x64-allos-enu.exe$SasToken" -ForegroundColor Gray
Write-Host "  VC++ x64: $BlobBaseUrl/vc_redist.x64.exe$SasToken" -ForegroundColor Gray
```

## Integration in Intune

### Methode 1: Parameter im Installationsbefehl

In Intune, bei der App-Konfiguration, verwende diesen Installationsbefehl:

```powershell
powershell.exe -ExecutionPolicy Bypass -Command "& { $AzureBlobStorageUrl='https://saintuneautopilot.blob.core.windows.net/autopilot-software'; $AzureBlobSasToken='?sv=2021-06-08&ss=b&srt=sco...'; .\Install-AutopilotSoftware-Optimized.ps1 }"
```

### Methode 2: Wrapper-Script (Empfohlen)

Erstelle ein Wrapper-Script mit den Credentials:

**Install-AutopilotSoftware-Wrapper.ps1:**
```powershell
<#
.SYNOPSIS
    Wrapper Script mit Azure Blob Storage Konfiguration
#>
[CmdletBinding()]
param()

# Azure Blob Storage Konfiguration
$AzureBlobStorageUrl = "https://saintuneautopilot.blob.core.windows.net/autopilot-software"
$AzureBlobSasToken = "?sv=2021-06-08&ss=b&srt=sco&sp=r&se=2026-10-25T12:00:00Z&st=2025-10-25T12:00:00Z&spr=https&sig=..."

# Rufe das eigentliche Script auf
& "$PSScriptRoot\Install-AutopilotSoftware-Optimized.ps1" `
    -AzureBlobStorageUrl $AzureBlobStorageUrl `
    -AzureBlobSasToken $AzureBlobSasToken
```

Dann in Intune:
```powershell
powershell.exe -ExecutionPolicy Bypass -File Install-AutopilotSoftware-Wrapper.ps1
```

### Methode 3: Azure Key Vault (Enterprise)

Für höchste Sicherheit, speichere das SAS Token in Azure Key Vault:

```powershell
# In Install-AutopilotSoftware-Optimized.ps1
$KeyVaultName = "kv-intune-autopilot"
$SecretName = "autopilot-sas-token"

# Hole SAS Token von Key Vault (benötigt Managed Identity)
$AzureBlobSasToken = Get-AzKeyVaultSecret -VaultName $KeyVaultName -Name $SecretName -AsPlainText
```

## Software-Updates verwalten

Wenn neue Versionen verfügbar sind:

```powershell
# 1. Neue Dateien herunterladen
$DownloadPath = "$env:TEMP\AutopilotSoftware"
Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vc_redist.x64.exe" -OutFile "$DownloadPath\vc_redist.x64.exe"

# 2. In Azure Blob Storage hochladen (überschreibt alte Version)
Set-AzStorageBlobContent `
    -File "$DownloadPath\vc_redist.x64.exe" `
    -Container $ContainerName `
    -Blob "vc_redist.x64.exe" `
    -Context $Context `
    -Force

Write-Host "Update erfolgreich!" -ForegroundColor Green
```

## Monitoring und Troubleshooting

### Blob Storage Logs aktivieren

```powershell
# Storage Analytics Logging aktivieren
Set-AzStorageServiceLoggingProperty `
    -ServiceType Blob `
    -Context $Context `
    -LoggingOperations Read `
    -RetentionDays 7

# Storage Analytics Metrics aktivieren
Set-AzStorageServiceMetricsProperty `
    -ServiceType Blob `
    -MetricsType Hour `
    -Context $Context `
    -MetricsLevel ServiceAndApi `
    -RetentionDays 7
```

### Download-Statistiken anzeigen

```powershell
# Blob Properties anzeigen
$Blobs = Get-AzStorageBlob -Container $ContainerName -Context $Context

foreach ($Blob in $Blobs) {
    $Properties = $Blob.ICloudBlob.Properties

    [PSCustomObject]@{
        Name             = $Blob.Name
        SizeGB          = [Math]::Round($Properties.Length / 1GB, 2)
        LastModified    = $Properties.LastModified
        ContentType     = $Properties.ContentType
    }
}
```

## Kosten-Optimierung

### Geschätzte Kosten (West Europe, Stand 2025)

**Storage:**
- .NET Framework 4.8 Offline: 116 MB
- VC++ Redist x64: ~25 MB
- VC++ Redist x86: ~14 MB
- **Gesamt:** ~155 MB

**Monatliche Kosten:**
- **Storage (Hot, LRS):** ~0.155 GB × $0.0208/GB = **~$0.003/Monat**
- **Transaktionen (Read):** 1000 Geräte × 3 Dateien × $0.0004/10000 = **~$0.0001**
- **Egress:** 1000 Geräte × 155 MB × $0.087/GB = **~$13.49/Monat**

**Gesamt für 1000 Autopilot-Geräte/Monat: ~$13.50**

### Kosten reduzieren

1. **Lifecycle Management:** Alte Versionen automatisch löschen
```powershell
# Lifecycle Management Policy erstellen
$Rule = Add-AzStorageAccountManagementPolicyAction `
    -InputObject (New-AzStorageAccountManagementPolicyFilter -PrefixMatch "old/*") `
    -BaseBlobAction Delete `
    -DaysAfterModificationGreaterThan 90

Set-AzStorageAccountManagementPolicy `
    -ResourceGroupName $ResourceGroupName `
    -AccountName $StorageAccountName `
    -Rule $Rule
```

2. **CDN verwenden** (für globale Verteilung)
```powershell
# Azure CDN Endpoint erstellen
$CdnProfileName = "cdn-intune-autopilot"
$CdnEndpointName = "autopilot-software"

New-AzCdnProfile `
    -ResourceGroupName $ResourceGroupName `
    -ProfileName $CdnProfileName `
    -Location $Location `
    -Sku Standard_Microsoft

New-AzCdnEndpoint `
    -ResourceGroupName $ResourceGroupName `
    -ProfileName $CdnProfileName `
    -EndpointName $CdnEndpointName `
    -Location $Location `
    -OriginHostHeader "$StorageAccountName.blob.core.windows.net" `
    -OriginName "storage" `
    -OriginPath "/$ContainerName"
```

## Sicherheits-Best Practices

1. **Minimal Permissions:**
   - SAS Token nur mit Read-Permission
   - IP-Beschränkungen wenn möglich
   - Kurze Gültigkeitsdauer

2. **Network Security:**
```powershell
# Firewall aktivieren
Update-AzStorageAccountNetworkRuleSet `
    -ResourceGroupName $ResourceGroupName `
    -Name $StorageAccountName `
    -DefaultAction Deny

# Azure Services erlauben
Add-AzStorageAccountNetworkRule `
    -ResourceGroupName $ResourceGroupName `
    -Name $StorageAccountName `
    -TenantId (Get-AzContext).Tenant.Id `
    -ResourceGroupName $ResourceGroupName
```

3. **Monitoring:**
```powershell
# Diagnostic Settings aktivieren
$StorageAccount = Get-AzStorageAccount -ResourceGroupName $ResourceGroupName -Name $StorageAccountName

Set-AzDiagnosticSetting `
    -ResourceId "$($StorageAccount.Id)/blobServices/default" `
    -Name "BlobDiagnostics" `
    -Enabled $true `
    -MetricCategory AllMetrics `
    -RetentionEnabled $true `
    -RetentionInDays 30
```

## Wartung und Updates

### Automatisches Update-Script

```powershell
<#
.SYNOPSIS
    Aktualisiert automatisch Software in Azure Blob Storage
#>

# Konfiguration
$ResourceGroupName = "rg-intune-autopilot"
$StorageAccountName = "saintuneautopilot"
$ContainerName = "autopilot-software"

# Storage Context
$StorageAccount = Get-AzStorageAccount -ResourceGroupName $ResourceGroupName -Name $StorageAccountName
$Context = $StorageAccount.Context

# Software-Definitionen
$Software = @(
    @{
        Name = "Visual C++ Redistributable x64"
        Url  = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
        Blob = "vc_redist.x64.exe"
    },
    @{
        Name = "Visual C++ Redistributable x86"
        Url  = "https://aka.ms/vs/17/release/vc_redist.x86.exe"
        Blob = "vc_redist.x86.exe"
    }
)

$TempPath = "$env:TEMP\AutopilotUpdate"
New-Item -Path $TempPath -ItemType Directory -Force | Out-Null

foreach ($Item in $Software) {
    Write-Host "Prüfe Update für: $($Item.Name)" -ForegroundColor Cyan

    # Download neue Version
    $TempFile = "$TempPath\$($Item.Blob)"
    Invoke-WebRequest -Uri $Item.Url -OutFile $TempFile

    # Prüfe ob sich die Datei geändert hat
    $NewHash = Get-FileHash -Path $TempFile -Algorithm SHA256

    # Hole aktuellen Blob
    $CurrentBlob = Get-AzStorageBlob -Container $ContainerName -Blob $Item.Blob -Context $Context -ErrorAction SilentlyContinue

    if ($null -ne $CurrentBlob) {
        # Download aktuellen Blob
        $CurrentFile = "$TempPath\current_$($Item.Blob)"
        Get-AzStorageBlobContent -Container $ContainerName -Blob $Item.Blob -Destination $CurrentFile -Context $Context -Force | Out-Null

        $CurrentHash = Get-FileHash -Path $CurrentFile -Algorithm SHA256

        if ($NewHash.Hash -eq $CurrentHash.Hash) {
            Write-Host "  Keine Änderung - überspringe" -ForegroundColor Gray
            continue
        }
    }

    # Upload neue Version
    Write-Host "  Lade neue Version hoch..." -ForegroundColor Yellow

    Set-AzStorageBlobContent `
        -File $TempFile `
        -Container $ContainerName `
        -Blob $Item.Blob `
        -Context $Context `
        -Force | Out-Null

    Write-Host "  Update erfolgreich!" -ForegroundColor Green
}

# Cleanup
Remove-Item -Path $TempPath -Recurse -Force
Write-Host ""
Write-Host "Update-Prozess abgeschlossen!" -ForegroundColor Green
```

## Zusammenfassung

**Empfohlene Setup-Strategie:**

1. **Kleine Umgebungen (<100 Geräte):**
   - Verwende Microsoft Download (kein Setup erforderlich)
   - Aktuelle Lösung im Script

2. **Mittlere Umgebungen (100-1000 Geräte):**
   - Azure Blob Storage mit SAS Token
   - Monatliche Software-Updates
   - Optimized Script verwenden

3. **Große Umgebungen (>1000 Geräte):**
   - Azure Blob Storage + CDN
   - Automatische Updates
   - Key Vault für Secrets
   - Monitoring und Alerting

---

**Hinweis:** Die optimierte Version mit Azure Blob Storage Support ist bereits im Script `Install-AutopilotSoftware-Optimized.ps1` enthalten.
