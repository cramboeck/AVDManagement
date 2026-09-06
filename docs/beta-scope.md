# Beta-Scope: Aktionen pro Modul

## Auswahlkriterium

> "Welche fuenf Aktionen spart einem MSP-Admin die meiste Zeit pro Woche?"

Fokus auf repetitive, zeitaufwaendige Aufgaben, die mehrmals taeglich oder woechentlich
ueber mehrere Tenants hinweg ausgefuehrt werden.

---

## AVD-Modul (Azure Virtual Desktop)

### Enthalten in Beta

| Aktion | Begruendung |
|--------|-------------|
| **Session-Host starten/stoppen** | Taegliche Routine: Hosts morgens hochfahren, abends herunterfahren. Ohne Automatisierung muss der Admin in jeden Tenant einzeln. |
| **Benutzer von Session trennen** | Support-Kernaufgabe: Benutzer meldet Problem, Admin muss Session beenden. Mehrmals taeglich. |
| **Session-Host-Status Dashboard** | Ueberblick ueber alle Tenants: welche Hosts laufen, wie viele Sessions. Ersetzt manuelles Durchklicken. |
| **Host-Pool-Uebersicht** | Schneller Zugriff auf Konfiguration und Zustand aller Host Pools uebergreifend. |
| **Drain-Mode setzen** | Wartungsarbeiten: Host aus Rotation nehmen, ohne laufende Sessions zu stoeren. |

### Explizit NICHT in Beta

| Aktion | Begruendung |
|--------|-------------|
| Image-Management | Komplex, erfordert Azure DevOps/Image Builder Integration. Phase 2. |
| Autoscaling-Konfiguration | Erfordert Schedule-Engine und komplexe Logik. Phase 2. |
| FSLogix-Profil-Management | Erfordert Storage-Account-Zugriff, eigene Komplexitaet. Phase 2. |
| Host-Pool-Erstellung | Selten, Azure Portal ist akzeptabel. Phase 2+. |
| Application-Group-Management | Abhaengig von Host-Pool-Erstellung. Phase 2+. |

---

## Intune-Modul (Device Management)

### Enthalten in Beta

| Aktion | Begruendung |
|--------|-------------|
| **Geraete-Sync anfordern** | Haeufigste Support-Aktion: "Mein Geraet hat die Policy nicht". Schneller Sync statt warten. |
| **Compliance-Status-Dashboard** | Ueberblick: welche Geraete sind non-compliant? Priorisierung ohne Tenant-Wechsel. |
| **Geraet neustarten** | Remote-Neustart fuer festhaengende Geraete. Schnelle Problemloesung. |
| **Geraete-Suche (uebergreifend)** | "Wo ist Geraet X registriert?" Suche ueber alle Tenants. |
| **Wipe/Retire ausloesen** | Offboarding: Geraet bei Mitarbeiter-Austritt zuruecksetzen. |

### Explizit NICHT in Beta

| Aktion | Begruendung |
|--------|-------------|
| App-Deployment | PatchMyPC/RoboPack sind besser. Kein Konkurrenzprodukt. |
| Configuration-Profile-Erstellung | Komplex, besser im Intune-Portal. |
| Compliance-Policy-Erstellung | Selten, einmalige Einrichtung. |
| Autopilot-Profile | Einrichtungsaufgabe, nicht taeglich. |
| Windows-Update-Ringe | Einmal einrichten, selten aendern. |

---

## Identity-Modul (M365 Benutzer/Gruppen/Lizenzen)

### Enthalten in Beta

| Aktion | Begruendung |
|--------|-------------|
| **Benutzer deaktivieren** | Offboarding-Kernaufgabe: Konto sperren, Sessions beenden. Mehrmals woechentlich. |
| **Passwort zuruecksetzen** | Support-Klassiker: "Ich habe mein Passwort vergessen". Mehrmals taeglich. |
| **Lizenz zuweisen/entziehen** | Onboarding/Offboarding: Lizenz anpassen. Regelmaessig. |
| **Benutzer-Suche (uebergreifend)** | "In welchem Tenant ist Max Mustermann?" Schnelle Suche. |
| **Gruppen-Mitgliedschaft aendern** | Berechtigungssteuerung: Benutzer zu Gruppe hinzufuegen. |

### Explizit NICHT in Beta

| Aktion | Begruendung |
|--------|-------------|
| Benutzer-Erstellung | Onboarding-Workflow komplex, besser mit Vorlagen. Phase 2. |
| MFA-Registrierung erzwingen | Einmalige Einrichtung pro Tenant. |
| Conditional-Access-Policies | Komplex, Sicherheitsrisiko bei Fehlern. Phase 2+. |
| Gruppen-Erstellung | Selten, Portal ausreichend. |
| Guest-User-Management | Spezialfall, Phase 2. |

---

## Exchange-Modul (Exchange Online)

### Enthalten in Beta

| Aktion | Begruendung |
|--------|-------------|
| **Shared-Mailbox-Berechtigungen** | Haeufige Anfrage: "Ich brauche Zugriff auf Mailbox X". PowerShell-Pflicht. |
| **Out-of-Office setzen** | Vertretung einrichten. Mehrmals woechentlich. |
| **Mailbox-Statistiken** | Speicherverbrauch pruefen, grosse Mailboxen finden. |
| **Postfach-Suche (uebergreifend)** | "Gibt es eine Mailbox fuer info@kunde.de?" |
| **Send-As/Send-on-Behalf** | Stellvertretung konfigurieren. Haeufige Anfrage. |

### Explizit NICHT in Beta

| Aktion | Begruendung |
|--------|-------------|
| Transport-Rules | Komplex, Fehler haben grosse Auswirkungen. Phase 2. |
| Mail-Flow-Tracking | Aufwaendig, erfordert Log-Analyse. Phase 2. |
| Retention-Policies | Compliance-kritisch, selten geaendert. Phase 2+. |
| eDiscovery | Spezialfall, rechtliche Anforderungen. Out-of-scope. |
| Migration | Eigenes Projekt, nicht Teil der Konsole. |

---

## Licenses-Modul (Lizenzverwaltung mit CSP-Integration)

### Enthalten in Beta

| Aktion | Begruendung |
|--------|-------------|
| **Lizenz-Uebersicht pro Tenant** | Wie viele Lizenzen sind verfuegbar/verbraucht? |
| **Lizenz-Zuweisung** | Einzelne Lizenz an Benutzer zuweisen. |
| **Lizenz-Entzug** | Lizenz bei Offboarding entfernen. |
| **Lizenz-Bestellung (ADN)** | Direkt aus Konsole Lizenzen nachbestellen. Zeitersparnis vs. Portal-Wechsel. |
| **Low-License-Alert** | Warnung wenn Lizenzen knapp werden. |

### Explizit NICHT in Beta

| Aktion | Begruendung |
|--------|-------------|
| Lizenz-Optimierung | Analyse ungenutzter Lizenzen. Phase 2. |
| Bulk-Bestellung | Komplex, Fehlerrisiko. Phase 2. |
| Multi-Distributor | Nur ADN in Beta, weitere spaeter. |
| Kostenreports | Reporting-Feature, Phase 2. |
| True-Up-Tracking | Komplex, abhaengig von CSP-Vertrag. Phase 2. |

---

## Zusammenfassung Beta-Scope

| Modul | Aktionen | Fokus |
|-------|----------|-------|
| AVD | 5 | Session-Management, Host-Kontrolle |
| Intune | 5 | Geraete-Troubleshooting, Compliance |
| Identity | 5 | User-Lifecycle, Passwort, Lizenzen |
| Exchange | 5 | Mailbox-Berechtigungen, Stellvertretung |
| Licenses | 5 | Uebersicht, Zuweisung, Bestellung |
| **Gesamt** | **25** | |

## Beta-Nicht-Ziele (explizit)

- **Keine Module:** Defender, Copilot, Purview, Windows 365
- **Kein Autoscaling:** AVD-Autoscaling ist Phase 2
- **Kein App-Deployment:** Intune-App-Management bleibt bei Spezialtools
- **Keine Policy-Erstellung:** Compliance, Conditional Access, Transport Rules
- **Keine Bulk-Operationen:** Einzelaktionen zuerst, Bulk in Phase 2
- **Keine NinjaRMM-Integration:** Bidirektionale Integration ist Phase 2
- **Kein Multi-Distributor:** Nur ADN in Beta
