# AVD-Modul Implementierungsplan

## Status: In Bearbeitung

Ziel: Marktreifes AVD-Management-Produkt aehnlich Hydra/Nerdio

---

## Technische Grundlagen

### API-Unterschied
- **Identity/Exchange/Intune**: Microsoft Graph API (`graph.microsoft.com`)
- **AVD**: Azure Resource Manager API (`management.azure.com`)

AVD-Ressourcen sind Azure-Ressourcen, keine Graph-Objekte. Wir brauchen:
1. Einen ARM-Client (analog zum GraphClient)
2. Azure RBAC-Rollen statt Graph Permissions

### Erforderliche Azure-Berechtigungen
| Rolle | Scope | Verwendung |
|-------|-------|------------|
| Desktop Virtualization Reader | Subscription/RG | Host Pools und Session Hosts lesen |
| Desktop Virtualization Contributor | Subscription/RG | Drain-Mode, Sessions trennen |
| Virtual Machine Contributor | VMs | VMs starten/stoppen |

---

## Implementierungsreihenfolge (Beta-Scope)

### Phase 1: Infrastruktur (2-3 Tage)
- [x] ARM-Client erstellen (`packages/core/src/providers/arm-client.ts`)
- [x] AVD-Provider erstellen (`packages/core/src/providers/avd-provider.ts`)
- [x] Datenbank-Schema erweitern (Host Pools, Session Hosts)
- [x] Typen definieren (`packages/types/src/avd.ts`)

### Phase 2: Lese-Operationen (1-2 Tage)
- [ ] Host-Pool-Liste abrufen
- [ ] Session-Host-Status abrufen
- [ ] Aktive Sessions pro Host
- [ ] API-Routen erstellen
- [ ] Frontend: Host-Pool-Uebersicht

### Phase 3: Schreib-Operationen als Jobs (2-3 Tage)
- [ ] Job: Session-Host starten (`avd.start-session-host`)
- [ ] Job: Session-Host stoppen (`avd.stop-session-host`)
- [ ] Job: Benutzer-Session trennen (`avd.disconnect-session`)
- [ ] Job: Drain-Mode setzen (`avd.set-drain-mode`)
- [ ] Preview-Generatoren fuer alle Jobs

### Phase 4: Frontend (2-3 Tage)
- [ ] Host-Pool-Dashboard
- [ ] Session-Host-Liste mit Status-Indikatoren
- [ ] Aktions-Buttons (Start/Stop/Drain)
- [ ] Session-Liste pro Host
- [ ] Bulk-Aktionen

### Phase 5: Polish (1-2 Tage)
- [ ] Error States (401, 403, 429, 404)
- [ ] Loading States
- [ ] Empty States
- [ ] Keyboard Navigation
- [ ] Audit-Integration verifizieren

---

## API-Endpunkte (Azure ARM)

### Host Pools
```
GET /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.DesktopVirtualization/hostPools
GET /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.DesktopVirtualization/hostPools/{name}
```

### Session Hosts
```
GET /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.DesktopVirtualization/hostPools/{hp}/sessionHosts
PATCH /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.DesktopVirtualization/hostPools/{hp}/sessionHosts/{sh}
```

### User Sessions
```
GET /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.DesktopVirtualization/hostPools/{hp}/sessionHosts/{sh}/userSessions
DELETE /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.DesktopVirtualization/hostPools/{hp}/sessionHosts/{sh}/userSessions/{session}
POST .../userSessions/{session}/disconnect
POST .../userSessions/{session}/sendMessage
```

### VM-Operationen
```
POST /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{vm}/start
POST /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{vm}/deallocate
```

---

## Datenmodell (Erweiterung)

### syncedHostPools
| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | PK |
| mspId | UUID | FK |
| tenantId | UUID | FK |
| azureSubscriptionId | string | Azure Subscription |
| resourceGroupName | string | Resource Group |
| name | string | Host-Pool-Name |
| hostPoolType | enum | personal, pooled |
| loadBalancerType | enum | breadthFirst, depthFirst |
| maxSessionLimit | int | Max Sessions pro Host |
| preferredAppGroupType | string | Desktop, RailApplications |
| validationEnvironment | boolean | Ist Validierungsumgebung |
| customRdpProperty | text | RDP-Einstellungen |
| friendlyName | string | Anzeigename |
| syncedAt | timestamp | Letzter Sync |

### syncedSessionHosts
| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | PK |
| mspId | UUID | FK |
| tenantId | UUID | FK |
| hostPoolId | UUID | FK |
| azureResourceId | string | ARM Resource ID |
| name | string | VM-Name |
| status | enum | Available, Unavailable, Shutdown, Disconnected, Upgrading |
| allowNewSession | boolean | Drain-Mode |
| sessions | int | Aktive Sessions |
| lastHeartbeat | timestamp | Letzter Heartbeat |
| osVersion | string | Windows-Version |
| sxSStackVersion | string | AVD-Agent-Version |
| lastUpdateTime | timestamp | Letzte Aenderung |
| vmResourceId | string | VM Resource ID |
| syncedAt | timestamp | Letzter Sync |

---

## Job-Definitionen

### avd.start-session-host
```typescript
{
  type: 'avd.start-session-host',
  displayName: 'Session-Host starten',
  maxRetries: 2,
  timeoutSeconds: 180,  // VM-Start kann dauern
  concurrencyPerTenant: 3,
  requiresPreview: true
}
```

### avd.stop-session-host
```typescript
{
  type: 'avd.stop-session-host',
  displayName: 'Session-Host stoppen',
  maxRetries: 1,
  timeoutSeconds: 120,
  concurrencyPerTenant: 3,
  requiresPreview: true  // Warnung wenn aktive Sessions
}
```

### avd.set-drain-mode
```typescript
{
  type: 'avd.set-drain-mode',
  displayName: 'Drain-Modus setzen',
  maxRetries: 2,
  timeoutSeconds: 30,
  concurrencyPerTenant: 5,
  requiresPreview: false  // Schnelle Aktion, kein Preview noetig
}
```

### avd.disconnect-session
```typescript
{
  type: 'avd.disconnect-session',
  displayName: 'Benutzer-Session trennen',
  maxRetries: 1,
  timeoutSeconds: 30,
  concurrencyPerTenant: 5,
  requiresPreview: false
}
```

---

## Naechste Schritte

1. ARM-Client implementieren
2. AVD-Provider mit Basis-Operationen
3. Datenbank-Migration
4. API-Routen
5. Job-Handler
6. Frontend
