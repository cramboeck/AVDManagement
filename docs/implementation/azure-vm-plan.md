# Modul "Azure VMs" — Plan und Stand

Status: Stufe V1 umgesetzt (Bestand, Detail, Start/Stop/Neustart/Groesse
als Jobs, Bereitstellung aus versionierten ARM-Vorlagen mit Validierung
und Kostenschaetzung). Stufen V2 und V3 offen.

## Ziel

Azure-VMs der Kundentenants aus dem Cockpit heraus sehen und steuern und
neue Maschinen reproduzierbar aus Vorlagen anlegen, ohne Klickstrecken im
Azure-Portal. AVD-Sitzungshosts sind der erste Anwendungsfall.

## V1 (umgesetzt)

- `VmProvider` (ARM, Microsoft.Compute 2024-03-01): VMs aller
  Subscriptions mit Betriebszustand (`statusOnly`), Detail mit
  Instanzansicht, Netzwerkkarten (private/oeffentliche IP, Subnetz, MAC),
  Datentraegern, Erweiterungen, Identitaet; Aktionen Start, Deallocate,
  Neustart, Groesse (PATCH hardwareProfile); Groessenliste je Region,
  Ressourcengruppen, Subnetze; `validate` und `PUT deployments` mit
  Warten auf `provisioningState`.
- Vorlagenkatalog `packages/core/templates/azure/*.json` (ARM JSON,
  `metadata.zsc` mit Id, Name, Version, OS). Parameter werden aus der
  Vorlage gelesen und Eingaben streng dagegen geprueft (Typ, erlaubte
  Werte, Namensmuster, Subnetz-Id, Tags). Sichere Parameter
  (`adminPassword`) befuellt das Cockpit selbst.
- Erste Vorlage `windows-vm` 1.0.0: NIC ohne oeffentliche IP, VM mit
  Trusted Launch (Secure Boot, vTPM), System-Identitaet, Marketplace-Image
  (Windows 11 Multi-Session/Enterprise 24H2, Server 2022/2025), OS-Disk mit
  `deleteOption Delete`, Boot-Diagnose mit verwaltetem Speicher, optional
  Entra-Join (AADLoginForWindows), Hybrid Benefit waehlbar.
- Jobs `vm.start`, `vm.stop`, `vm.restart`, `vm.resize` (Vorschau mit
  Zustand und Kostenvergleich), `vm.deploy` (Vorschau = ARM-Validierung mit
  Platzhalterpasswort plus Kostenschaetzung; Ausfuehrung erzeugt das
  Passwort, legt bei Bedarf die Ressourcengruppe an, wartet auf die
  Bereitstellung und versiegelt Benutzer und Passwort im Ergebnis; Anzeige
  wie bei LAPS nur mit Begruendung, Rolle Engineer und Audit; Loeschung
  nach 30 Tagen).
- Kostenschaetzung aus der oeffentlichen Azure-Preisliste
  (prices.azure.com, Listenpreis EUR, ein Tag im Speicher).
- Web: Seite Azure VMs mit Kennzahlen, Tabelle und Aktionen, Detailseite,
  Dialog "Neue VM aus Vorlage".
- Benoetigte Azure-Rollen fuer die App-Registrierung je Subscription:
  Reader (Bestand), Virtual Machine Contributor (Aktionen), Contributor
  auf der Ressourcengruppe (Bereitstellung, Anlegen der Gruppe), fuer
  Entra-Join zusaetzlich keine (die VM bekommt eine System-Identitaet).

## V2 (offen)

- AVD-Sitzungshost-Vorlage: Registrierung am Host Pool ueber das
  Registrierungstoken (DSC-Erweiterung), FSLogix-Parameter, Domain- oder
  Entra-Join mit Intune-Enrollment.
- Bulk: N Hosts aus einer Vorlage mit Namensmuster, Ring-Rollout.
- Zeitplaene: Start/Stop nach Kalender je VM oder Tag (Kostenbremse),
  Uebersicht "laeuft ausserhalb der Arbeitszeit".
- Loeschen als Job mit verschaerfter Vorschau (Datentraeger, NIC, IP).

## V3 (offen)

- Bicep-Quellen im Repo mit Build-Schritt zu ARM JSON (heute ARM JSON
  direkt), Vorlagen je MSP im Katalog mit Freigabe.
- Kostenbericht je Kunde aus der Cost-Management-API.
- Snapshot-Kind `vms` im Bestands-Cache fuer die Dashboard-Kacheln.
