# Exchange-Worker

Alles, was Exchange Online nur per PowerShell kann, laeuft ueber diesen
Worker: Kontingente, Weiterleitung auf Postfachebene, Vollzugriff und
Senden als, Archiv, Umwandlung in freigegebene Postfaecher, Beweissicherung
und das Einsammeln dieser Daten je Tenant. Die API legt Auftraege an, der
Worker holt sie mit seiner eigenen Identitaet und meldet Ergebnis und
Protokoll zurueck. Das Zertifikat bleibt beim Worker; die API kennt nur das
Worker-Token.

Der Worker kennt eine feste Liste von Operationen und baut die Cmdlet-
Aufrufe selbst. Freier PowerShell-Text kommt nie von der API. Jede
Operation prueft ihre Parameter noch einmal (UPN-Muster, Kontingentformat,
Postfachtyp).

## Voraussetzungen

- Windows PowerShell 5.1 oder PowerShell 7 mit dem Modul
  `ExchangeOnlineManagement` 3.x (`Install-Module ExchangeOnlineManagement`).
- Eine App-Registrierung im Partnertenant mit der Anwendungsberechtigung
  `Exchange.ManageAsApp` (Office 365 Exchange Online) und einem
  Zertifikat als Anmeldeinformation. Der Service Principal braucht in jedem
  Kundentenant die Rolle **Exchange Administrator** (Entra-Rollen), damit
  `Connect-ExchangeOnline -AppId -CertificateThumbprint -Organization`
  funktioniert. Anleitung: Microsoft-Doku "App-only authentication for
  unattended scripts in Exchange Online PowerShell".
- Zertifikat im Zertifikatspeicher des Worker-Kontos (`certificateThumbprint`)
  oder als `.pfx` (`certificateFilePath`, Passwort in `ZSC_EXO_CERT_PASSWORD`,
  fuer Linux-Container). Nie im Repo.
- In der API ist `WORKER_TOKEN` gesetzt.

## Einrichten

```powershell
Copy-Item worker.config.example.json worker.config.json
# apiUrl, appId, certificateThumbprint anpassen
.\Set-WorkerToken.ps1                    # Windows: Token DPAPI-geschuetzt ablegen
$env:ZSC_WORKER_TOKEN = '...'            # oder als Umgebungsvariable (Linux immer so)
.\Start-ExchangeWorker.ps1               # laeuft, bis er beendet wird
.\Start-ExchangeWorker.ps1 -Once         # genau einen Auftrag
```

`worker.token` und `worker.config.json` stehen in `.gitignore`.

## Ablauf je Auftrag

1. `POST /worker/exchange/claim` liefert Tenant (`organization` = initiale
   .onmicrosoft.com-Domaene), Operation und Parameter.
2. `Connect-ExchangeOnline` app-only fuer diesen Tenant (Sitzung wird je
   Tenant wiederverwendet, im Leerlauf getrennt).
3. Operation ausfuehren, Fortschritt per `POST .../log`.
4. `POST .../complete` mit Ergebnis oder Fehler und dem Protokoll.

Bleibt ein Auftrag eine Stunde ohne Lebenszeichen, setzt ihn die API auf
"fehlgeschlagen".

## Operationen

| Operation | Cmdlets |
|---|---|
| `collect-facts` | `Get-EXOMailbox` (bis 2000 Postfaecher), `Get-EXOMailboxPermission` und `Get-EXORecipientPermission` (bis 500), `Get-HostedOutboundSpamFilterPolicy` |
| `set-quota` | `Set-Mailbox -IssueWarningQuota -ProhibitSendQuota -ProhibitSendReceiveQuota` |
| `set-forwarding` | `Set-Mailbox -ForwardingSmtpAddress -DeliverToMailboxAndForward` |
| `set-full-access` | `Add-MailboxPermission` / `Remove-MailboxPermission` FullAccess |
| `set-send-as` | `Add-RecipientPermission` / `Remove-RecipientPermission` SendAs |
| `enable-archive` | `Enable-Mailbox -Archive` |
| `convert-mailbox` | `Set-Mailbox -Type Shared` oder `Regular` |
| `set-litigation-hold` | `Set-Mailbox -LitigationHoldEnabled [-LitigationHoldDuration]` |

Das Protokoll enthaelt Postfachadressen, aber keine Inhalte.
