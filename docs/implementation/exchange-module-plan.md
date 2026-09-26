# Modul "Exchange Online" — Plan

Status: Stufe E0 (Nutzungsberichte) und E1 (Postfachdetail, Abwesenheit,
Posteingangsregeln, Weiterleitungs-Scan) umgesetzt. Stufe E2 (Exchange-
Worker fuer alles, was nur PowerShell kann) geplant, siehe unten.

## Was Graph kann und was nicht

Graph deckt mit Anwendungsberechtigungen ab:

| Bereich | Graph | Berechtigung | Status |
|---|---|---|---|
| Groesse, Kontingente (lesen), Aktivitaet, Archiv ja/nein | `reports/getMailboxUsageDetail`, `getEmailActivityUserDetail` | `Reports.Read.All` | E0 |
| Abwesenheit (lesen, setzen), Zeitzone, Sprache, Zweck | `users/{id}/mailboxSettings` | `MailboxSettings.ReadWrite` | E1 |
| Posteingangsregeln (lesen, anlegen, an/aus, loeschen) | `users/{id}/mailFolders/inbox/messageRules` | `MailboxSettings.ReadWrite` | E1 |
| Aliasse | `users/{id}?$select=proxyAddresses` | `User.Read.All` | E1 |
| Verifizierte Domaenen (fuer "extern") | `organization?$select=verifiedDomains` | `Organization.Read.All` | E1 |

Graph kann nicht (Stand der oeffentlichen Doku):

- Kontingente aendern (`ProhibitSendQuota` usw.)
- Weiterleitung auf Postfachebene (`ForwardingSmtpAddress`,
  `DeliverToMailboxAndForward`)
- Postfachberechtigungen (Vollzugriff, Senden als, Senden im Auftrag)
- Archiv aktivieren, Auto-Expanding Archive
- Umwandlung Benutzer- <-> freigegebenes Postfach
- Aufbewahrung (Litigation Hold, Retention Policy)
- Transportregeln, Outbound-Spam-Richtlinie (die entscheidet, ob externe
  Weiterleitung ueberhaupt zugestellt wird)

Das alles liefert nur die Exchange-Online-PowerShell (`Exchange.ManageAsApp`
mit Zertifikat und der Exchange-Administrator-Rolle fuer den Service
Principal). Nicht dokumentierte Endpunkte des ExchangeOnlineManagement-
Moduls werden nicht direkt angesprochen.

## E1 (umgesetzt)

- `MailboxProvider` (Core): `getMailboxDetail`, `getSettings`, `listRules`,
  `getRule`, `setAutoReply`, `createForwardRule`, `setRuleEnabled`,
  `deleteRule`, `scanForwarding` ($batch, 20 Postfaecher je Aufruf, Limit
  1000 je Scan), `getTenantDomains`.
- Jobs: `mailbox.set-auto-reply`, `mailbox.create-forward-rule`,
  `mailbox.enable-rule`, `mailbox.disable-rule`, `mailbox.delete-rule`.
  Vorschau liest den Ist-Zustand live; Warnungen bei externen Zielen,
  Umleitung ohne Kopie, externer Antwort an alle, schreibgeschuetzten Regeln.
- Routen: `GET /tenants/:id/mail/mailboxes/:upn` (Audit `mail.mailbox.view`),
  `GET /tenants/:id/mail/forwarding-scan` (Audit `mail.forwarding.scan`),
  `POST .../mailboxes/:upn/auto-reply`, `POST .../mailboxes/:upn/rules`,
  `POST .../mailboxes/:upn/rules/:ruleId/enable|disable|delete`.
- Web: `/mail/[upn]` mit Kennzahlen, Abwesenheit, Adressen, Regeln und
  Aktionen; Panel "Weiterleitungen" auf der Exchange-Seite.

## E2: Exchange-Worker (geplant)

Gleiches Muster wie der Build-Worker: ein Dienst des MSP, der Auftraege bei
der API abholt, mit eigener Identitaet gegen Exchange arbeitet und
Ergebnisse meldet. Die API sieht nie das Zertifikat.

- Laufzeit: PowerShell 7 mit `ExchangeOnlineManagement` (v3, REST-basiert),
  Windows oder Linux-Container. Anmeldung
  `Connect-ExchangeOnline -AppId -CertificateThumbprint -Organization`.
- Identitaet: eine App-Registrierung je MSP mit `Exchange.ManageAsApp`,
  Zertifikat im Zertifikatspeicher des Worker-Kontos (oder Key Vault mit
  Managed Identity), Service Principal in jedem Kundentenant mit der
  Rolle Exchange Administrator (Consent wie heute ueber die
  Tenant-Anbindung, plus Rollenzuweisung).
- Vertrag: Tabelle `exchange_jobs` (tenant, cmdlet-Name aus einer
  Positivliste, Parameter als JSON, Status, Ergebnis, Log), Endpunkte
  `/worker/exchange/claim|log|complete` mit `WORKER_TOKEN`. Kein freier
  PowerShell-Text: der Worker kennt nur benannte Operationen
  (`set-quota`, `set-forwarding`, `add-full-access`, `remove-full-access`,
  `add-send-as`, `enable-archive`, `convert-to-shared`, `set-litigation-hold`)
  und baut die Cmdlet-Aufrufe selbst.
- Jobs im Cockpit: je Operation ein Job mit Vorschau (Ist-Zustand ueber
  einen Lese-Auftrag oder aus dem letzten Snapshot), Freigabe, Audit;
  Ergebnis kommt asynchron vom Worker (Job bleibt "running" bis
  `complete`).
- Lesend: `Get-Mailbox`, `Get-MailboxPermission`, `Get-RecipientPermission`,
  `Get-HostedOutboundSpamFilterPolicy` als Snapshot-Kind `exchange`
  (alle 6 h), damit das Postfachdetail Weiterleitung auf Postfachebene,
  Berechtigungen und Archivstatus zeigt und der Check "externe
  Weiterleitung erlaubt?" moeglich wird.
- Sicherheit: Positivliste der Cmdlets, Parameter-Schema je Operation,
  Tenant aus dem Auftrag (nie aus dem Parameter), Timeout je Auftrag,
  Log ohne Postfachinhalte.

Aufwand: Worker-Grundgeruest 1 Tag, erste vier Operationen 1 Tag,
Snapshot und Detail-Erweiterung 1 Tag.
