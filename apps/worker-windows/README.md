# Windows-Build-Worker

Der Worker macht aus Installer plus Manifest ein `.intunewin`. Er laeuft auf
einer Windows-Maschine des MSP (VM, Buildserver, Technikerrechner), holt
sich Auftraege von der Cockpit-API und meldet Ergebnis und Protokoll
zurueck. Die API baut nichts selbst und braucht kein Windows.

Ablauf je Auftrag:

1. `POST /worker/builds/claim` liefert den Bauplan (Manifest, Installer-
   Hash, Wrapper ja/nein, Setup-Datei, Marker-Schluessel, Argumente).
2. Installer herunterladen und SHA-256 pruefen.
3. `psadt`: PSAppDeployToolkit-v4-Vorlage kopieren, Installer nach `Files\`,
   `Invoke-AppDeployToolkit.ps1` aus `templates\` erzeugen (Install,
   Uninstall, Prozesse schliessen, Registry-Marker `Installed = Y`),
   Syntaxpruefung, optional signieren.
   `msi`/`exe`: Installer unveraendert verpacken.
4. `IntuneWinAppUtil.exe -c <source> -s <setup> -o <out> -q`.
5. `PUT /worker/builds/:id/artifact` laedt das `.intunewin` hoch; die API
   prueft den Hash und setzt das Paket auf "bereit".
6. `POST /worker/builds/:id/complete` mit Protokoll.

Der Worker sieht nur Auftraege, die er selbst haelt. Bleibt er zwei Stunden
stumm, faellt der Auftrag auf "fehlgeschlagen" zurueck und kann neu
gestartet werden.

## Voraussetzungen

- Windows 10/11 oder Server 2019+, Windows PowerShell 5.1 (kein PowerShell 7
  noetig).
- `IntuneWinAppUtil.exe` (Microsoft Win32 Content Prep Tool) von
  https://github.com/microsoft/Microsoft-Win32-Content-Prep-Tool
- Fuer `psadt`-Pakete: die Vorlage von PSAppDeployToolkit v4
  (`PSAppDeployToolkit_Template_v4` aus dem Release-Zip von
  https://github.com/PSAppDeployToolkit/PSAppDeployToolkit). Der Ordner muss
  `PSAppDeployToolkit\PSAppDeployToolkit.psd1` enthalten. Die Vorlage liegt
  nicht im Repo.
- Ein Worker-Token aus der Konsole: Einstellungen, Abschnitt "Worker-Token",
  "Token anlegen" (nur Owner). Der Klartext (`zsw_...`) erscheint genau einmal;
  die API speichert nur den Hash. Das Token gehoert zu genau einem MSP, der
  Worker sieht nur dessen Auftraege. Pro Worker-Installation ein eigenes
  Token, damit sich eines widerrufen laesst, ohne die anderen zu stoeren.
  Uebergangsweise akzeptiert die API auch `WORKER_TOKEN` aus ihrer Umgebung,
  aber nur solange genau ein MSP existiert.

## Einrichten

```powershell
Copy-Item worker.config.example.json worker.config.json
# apiUrl, workDir, intuneWinAppUtilPath, psadtTemplatePath anpassen
.\Set-WorkerToken.ps1      # Token DPAPI-geschuetzt in worker.token ablegen
.\Start-BuildWorker.ps1    # laeuft, bis er beendet wird
.\Start-BuildWorker.ps1 -Once   # genau einen Auftrag, dann Exit-Code 0/1/2
```

`worker.token` ist an das Windows-Konto gebunden, das `Set-WorkerToken.ps1`
ausgefuehrt hat. Fuer eine geplante Aufgabe also das Aufgabenkonto nehmen.
Alternativ `ZSC_WORKER_TOKEN` als Umgebungsvariable des Kontos setzen.
`worker.token` und `worker.config.json` sind in `.gitignore`.

Konfiguration:

| Schluessel | Bedeutung |
|---|---|
| `apiUrl` | Basis-URL der API ohne Pfad, z. B. `https://cockpit.example.com`; lokal `http://localhost:3001`. Plain http zu anderen Rechnern nur mit `allowInsecureHttp: true` (Labor, Token laeuft unverschluesselt) |
| `allowInsecureHttp` | `true` erlaubt http zu einer fremden Adresse, nur fuer ein Labor ohne TLS |
| `workerId` | Name im Cockpit-Protokoll, Standard Computername |
| `workDir` | Arbeitsordner; je Auftrag ein Unterordner, danach geloescht |
| `intuneWinAppUtilPath` | Pfad zu `IntuneWinAppUtil.exe` |
| `psadtTemplatePath` | Ordner der PSADT-v4-Vorlage (nur fuer psadt) |
| `pollSeconds` | Abfrageintervall, Standard 30 |
| `signingThumbprint` | Thumbprint eines Code-Signing-Zertifikats in `Cert:\CurrentUser\My` oder `Cert:\LocalMachine\My`; leer = nicht signieren |
| `keepWorkFolders` | `true` laesst Arbeitsordner zur Fehlersuche stehen |

## Fehlersuche

- "The term 'Get-FileHash' is not recognized" oder "module could not be
  loaded" fuer `Microsoft.PowerShell.Security`: meist stehen die Modulpfade
  von PowerShell 7 (`C:\Program Files\PowerShell\7\Modules`) vorn in
  `PSModulePath` einer 5.1-Sitzung, etwa weil das Fenster aus pwsh oder
  einem VS-Code-Terminal heraus gestartet wurde oder die Variable
  systemweit so gesetzt ist. 5.1 findet dann die 7er-Module zuerst und kann
  sie nicht laden. Die Worker-Skripte entfernen diese Pfade fuer ihren
  eigenen Prozess; fuer alles andere ein frisches "Windows PowerShell" aus
  dem Startmenue nehmen oder die Pfade aus der System-Umgebungsvariable
  `PSModulePath` streichen (PowerShell 7 haengt sie zur Laufzeit selbst an).
- "Unable to connect to the remote server" nach erfolgreichem Ping: die
  API ist nicht mehr erreichbar (Neustart nach Dateiaenderung oder
  Absturz). Der Worker versucht es mit wachsendem Abstand weiter.

## Als geplante Aufgabe

Aufgabe mit dem Dienstkonto anlegen, Trigger "beim Start" oder alle 5
Minuten mit `-Once`, Aktion:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ZeroStress\worker\Start-BuildWorker.ps1
```

## Was der Wrapper macht (psadt)

- `Show-ADTInstallationWelcome` schliesst die im Manifest genannten
  Prozesse (im Silent-Modus ohne Dialog) und prueft den Plattenplatz.
- MSI: `Start-ADTMsiProcess -Action Install` mit den Manifest-Parametern als
  `-AdditionalArgumentList`. EXE: `Start-ADTProcess` mit den Parametern.
- Nach der Installation schreibt er unter
  `HKLM\SOFTWARE\<Praefix>_IntuneAppInstall\Apps\<Bezeichner>` die Werte
  `Installed = Y`, `DisplayVersion`, `PackageIdentifier`, `InstalledOn`.
  Genau darauf prueft die Intune-Erkennung, die das Cockpit beim
  Veroeffentlichen anlegt.
- Deinstallation: Manifest-Befehl ueber `cmd /c`, sonst bei MSI
  `Start-ADTMsiProcess -Action Uninstall`; danach wird der Marker entfernt.
  EXE ohne Deinstallationsbefehl bricht mit Fehler ab, damit Intune nicht
  faelschlich Erfolg meldet.

Nicht unterstuetzt: zip-Installer (erst entpacken und die msi/exe
hochladen), Transforms (`.mst`), mehrere Installer je Paket.
