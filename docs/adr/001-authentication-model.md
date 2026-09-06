# ADR-001: Mandanten- und Authentifizierungsmodell

**Status:** Vorgeschlagen  
**Datum:** 2026-09-06  
**Entscheider:** Christoph Ramboeck  

## Kontext

ZeroStress Cockpit verwaltet Microsoft-Cloud-Ressourcen ueber mehrere Kundentenants hinweg. Der Zugriff auf diese Tenants kann ueber verschiedene Mechanismen erfolgen:

- **GDAP (Granular Delegated Admin Privileges):** Partnerbeziehung im Microsoft Partner Center
- **App-Consent:** Kundenadmin genehmigt App-Registrierung im eigenen Tenant
- **Hybrid:** Beide Modelle parallel

Die Wahl beeinflusst Sicherheit, Onboarding-Aufwand und verfuegbare Berechtigungen.

## Optionen

### Option A: Nur GDAP

Eine Multi-Tenant-App im Partner-Tenant. Zugriff auf Kundentenants erfolgt ueber GDAP-Rollen.

| Vorteile | Nachteile |
|----------|-----------|
| Zentrales Credential-Management | Nur fuer Partner-Kunden nutzbar |
| Granulare Rollenzuweisung pro Tenant | GDAP-Setup erfordert Kundenakzeptanz |
| Kein App-Consent pro Tenant noetig | Einige Graph-Scopes nicht via GDAP verfuegbar |
| Microsoft-empfohlener Weg fuer MSPs | |

### Option B: Nur App-Consent

Pro Kundentenant eine App-Registrierung oder Enterprise-App mit Admin-Consent.

| Vorteile | Nachteile |
|----------|-----------|
| Funktioniert ohne Partnerbeziehung | Credential-Management pro Tenant |
| Voller Scope-Zugriff moeglich | Aufwaendiges Onboarding |
| Unabhaengig von Partner Center | Jeder Tenant braucht Admin-Consent |

### Option C: Hybrid (GDAP + App-Consent)

GDAP als Primaermechanismus, App-Consent als Fallback fuer Tenants ohne Partnerbeziehung.

| Vorteile | Nachteile |
|----------|-----------|
| Maximale Flexibilitaet | Zwei Auth-Pfade zu warten |
| Kein Kunde ausgeschlossen | Komplexere Architektur |
| Schrittweise Migration moeglich | Unterschiedliche Berechtigungslevels |

## Entscheidung

**Option C: Hybrid (GDAP + App-Consent)**

Begruendung:
1. Solo-MSP hat bestehende Kundentenants mit und ohne Partnerbeziehung
2. Spaeterer Verkauf an andere MSPs erfordert Flexibilitaet
3. GDAP deckt nicht alle EXO-PowerShell-Szenarien ab

## Implementierung

### Primaerer Pfad: GDAP

```
Partner-Tenant (MSP)
    └── Multi-Tenant App Registration
            └── GDAP-Beziehung ──► Kunden-Tenant A
            └── GDAP-Beziehung ──► Kunden-Tenant B
```

- App-only Authentication mit Certificate Credential
- Zertifikat in Azure Key Vault (Managed Identity)
- GDAP-Rollen: Cloud Application Administrator, Intune Administrator, Exchange Administrator, Desktop Virtualization Contributor

### Sekundaerer Pfad: App-Consent

```
Kunden-Tenant (ohne GDAP)
    └── Enterprise App (via Admin Consent)
            └── Service Principal mit App-Permissions
```

- Consent-URL generiert durch ZeroStress
- Credentials nach Consent in Key Vault des MSP gespeichert
- Separate App-Registration pro Tenant (Isolation)

### Token-Akquisition

```typescript
interface TenantAuthConfig {
  tenantId: string;
  authMethod: 'gdap' | 'app-consent';
  // Bei GDAP: Partner-App-ID + GDAP-Beziehungs-ID
  // Bei App-Consent: Tenant-spezifische App-ID + Key-Vault-Secret-Reference
}
```

### Graph-Scopes nach Methode

| Scope | GDAP | App-Consent |
|-------|------|-------------|
| User.Read.All | Ja (via Rolle) | Ja |
| DeviceManagementManagedDevices.ReadWrite.All | Ja (via Rolle) | Ja |
| Exchange.ManageAsApp | Nein | Ja |
| DesktopVirtualization.* (ARM) | Ja (via Azure RBAC) | Ja |

## Konsequenzen

### Positiv
- Kein Kunde technisch ausgeschlossen
- GDAP-Kunden profitieren von vereinfachtem Onboarding
- Klare Trennung der Auth-Pfade

### Negativ
- Zwei Codepfade fuer Token-Akquisition
- EXO-PowerShell bei GDAP-Tenants eingeschraenkt (ggf. App-Consent zusaetzlich)
- Dokumentation muss beide Varianten abdecken

### Risiken
- GDAP-Rollen koennen sich aendern (Microsoft-Updates)
- App-Consent-Flow erfordert Publisher Verification fuer reibungsloses UX

## Revidierbarkeit

**Mittel.** Migration von App-Consent zu GDAP ist moeglich. Umgekehrt erfordert Credential-Migration. Beide Pfade koennen parallel existieren.
