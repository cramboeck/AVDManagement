# Nur-Lese-Betrieb

Fuer den Start bei Kunden: die Konsole zeigt alles an, aendert aber nichts.
Es gibt zwei Schalter und eine optionale zweite App-Registrierung. Sie
lassen sich kombinieren.

| Stufe | Wirkung | Schutz gegen |
|---|---|---|
| **Tenant auf Nur-Lesen** (Tenants > "Auf Nur-Lesen stellen", Rolle Owner) | Fuer diesen Tenant entstehen keine schreibenden Jobs; wartende werden beim Freigeben und beim Ausfuehren abgelehnt | Bedienfehler, versehentliche Aktionen bei einem Kunden, der nur Lesen vereinbart hat |
| **Konsole auf Nur-Lesen** (`CONSOLE_READ_ONLY=true`, Neustart der API) | Dasselbe fuer alle Tenants | Bedienfehler in einer Phase, in der gar nichts geaendert werden soll |
| **Nur-Lese-App-Registrierung** | Microsoft selbst verweigert Schreibzugriffe, auch wenn die Konsole kompromittiert waere | Angriff auf die Konsole oder ihre Anmeldedaten |

Die beiden Schalter sind Sperren **in der Konsole**. Hat die
App-Registrierung im Kundentenant Schreibrechte, koennte jemand mit
Zugriff auf Server oder Zertifikat diese weiterhin nutzen. Echte Sicherheit
gegen einen Angriff bringt erst die dritte Zeile.

## Was gesperrt ist und was nicht

Gesperrt sind alle Jobs, also jede Aenderung in einem Kundentenant:
Benutzer, Lizenzen, Gruppen, Geraeteaktionen, Skripte auf Geraeten,
Apps, AVD, Azure-VMs, Postfaecher. Jeder abgelehnte Versuch steht im
Audit (`result: failure`, `read-only-mode (tenant)` bzw. `(console)`).

Weiterhin erlaubt:

- Alles Lesende: Listen, Details, Sicherheitslage, Best Practices,
  Baselines, Alerts, Schwachstellen, Anmeldungen.
- Zuruecknehmen frueherer Aenderungen der Konsole: Admin auf Zeit
  entziehen, geplanten Neustart abbrechen, Geraete-Monitor und
  Haertungspruefung ausschalten. Sonst blieben zum Beispiel lokale
  Admin-Rechte bestehen, nur weil umgeschaltet wurde.
- Exchange-Postfachdaten einsammeln (der Exchange-Worker liest nur).
- Einstellungen der Konsole selbst (Team, Vier-Augen, Schwellen), weil
  sie keinen Kundentenant beruehren.

Sensible Lesezugriffe bleiben moeglich und werden wie bisher protokolliert:
BitLocker-Schluessel und LAPS-Passwoerter (mit Begruendung). Wer das in der
Nur-Lese-Phase nicht will, laesst die beiden Berechtigungen in der
Nur-Lese-App weg (siehe unten).

## Geraete-Monitor und Haertungspruefung im Nur-Lese-Betrieb

Beide legen beim Einschalten ein Remediation-Objekt im Tenant an. Das ist
ein Schreibzugriff und deshalb gesperrt. Reihenfolge, wenn ein Kunde nur
Lesen vereinbart hat, die Pruefung aber laufen soll:

1. Mit dem Kunden klaeren, dass zwei nur lesende Pruefskripte
   (`ZSC-monitor`, `ZSC-hardening`) als Remediation angelegt werden.
2. Tenant zunaechst auf "Aenderungen erlaubt", Monitor und
   Haertungspruefung einschalten.
3. Tenant auf Nur-Lesen stellen. Die Skripte laufen weiter und melden; die
   Konsole liest die Ergebnisse mit `DeviceManagementConfiguration.Read.All`.

Mit der Nur-Lese-App-Registrierung geht Schritt 2 nicht; dann fuer diesen
Schritt einmal die volle App nutzen oder die Skripte vom Kunden-Admin
anlegen lassen.

## Nur-Lese-App-Registrierung

Eine zweite mandantenfaehige Registrierung, zum Beispiel
**ZeroStress Cockpit Read**, nur mit Leseberechtigungen. Betrieben wird sie
heute als eigene Instanz der Konsole mit `CONSOLE_READ_ONLY=true`: eigene
`.env.local`, eigene Datenbank, `ENTRA_CLIENT_ID` und Zertifikat der
Lese-App. Eine Instanz, die je Tenant zwischen voller und Lese-App
umschaltet, ist noch nicht gebaut.

Anwendungsberechtigungen Microsoft Graph:

| Berechtigung | Wofuer |
|---|---|
| `Organization.Read.All` | Verbindungstest, Domaenen |
| `User.Read.All`, `Directory.Read.All` | Benutzer, Rollen, Gruppen |
| `Group.Read.All` | Gruppen und Mitglieder |
| `UserAuthenticationMethod.Read.All` | MFA-Methoden |
| `AuditLog.Read.All` | Anmeldungen, Verzeichnisaudit, MFA-Report (Entra ID P1) |
| `Policy.Read.All` | Conditional Access, Sicherheitsstandards, Methodenrichtlinien |
| `DeviceManagementManagedDevices.Read.All` | Intune-Geraete |
| `DeviceManagementConfiguration.Read.All` | Baselines, Compliance, Ergebnisse von Monitor und Haertung |
| `DeviceManagementApps.Read.All` | Intune-Apps und Installationsstatus |
| `SecurityEvents.Read.All`, `SecurityAlert.Read.All` | Secure Score, Defender-Alerts |
| `Reports.Read.All` | Exchange-, SharePoint- und OneDrive-Nutzung |
| `MailboxSettings.Read` | Abwesenheit, Posteingangsregeln, Weiterleitungs-Scan |
| `SharePointTenantSettings.Read.All` | Freigabe-Einstellungen |
| optional `BitLockerKey.Read.All`, `DeviceLocalCredential.Read.All` | Schluessel und LAPS; in der Nur-Lese-Phase besser weglassen |

Defender for Endpoint (WindowsDefenderATP): `Machine.Read.All`,
`Vulnerability.Read.All`, `Software.Read.All`, `Score.Read.All`, bei
Defender P2 `AdvancedQuery.Read.All`.

Azure: statt der Rollen fuer AVD und VMs nur **Leser** (Reader) auf den
Abos bzw. Ressourcengruppen des Kunden.

Nicht aufnehmen: alle `*.ReadWrite.*`, `*.PrivilegedOperations.*`,
`Mail.Send` und keine Entra-Rolle wie Benutzeradministrator fuer den
Service Principal.

## Pruefen

1. Tenant auf Nur-Lesen stellen, Begruendung eingeben. Im Audit steht
   `tenant.access-mode` mit vorher/nachher.
2. Unter Benutzer einen Benutzer deaktivieren wollen: der Dialog meldet
   "Dieser Tenant ist auf Nur-Lesen gestellt", im Audit steht der Versuch
   als Fehlschlag.
3. Einen anderen Tenant pruefen: dort geht die Aktion weiter.
4. `CONSOLE_READ_ONLY=true` setzen, API neu starten: die erste Logzeile
   meldet `CONSOLE_READ_ONLY: write jobs blocked`, oben in der Konsole
   steht das Banner "Nur-Lese-Betrieb".
