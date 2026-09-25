# Lokale Entwicklung und Tenant-Onboarding

## Voraussetzungen

- Node.js >= 20, npm >= 10
- Docker (Postgres + Redis via `docker-compose.yml`)
- Eine App-Registrierung in deinem Partnertenant (siehe unten)

## Umgebungsvariablen

Es gibt genau eine Datei: `.env.local` im Monorepo-Root. API und Web lesen
beide daraus (die API ueber `apps/api/src/env.ts`, Next.js ueber
`apps/web/next.config.js`). Kopien in `apps/api` oder `apps/web` sind
unnoetig und fuehren zu Verwirrung.

```powershell
Copy-Item .env.example .env.local
```

Pflichtwerte fuer die API: `DATABASE_URL`, `ENTRA_CLIENT_ID`,
`ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID`, `JWT_SECRET`. Fehlt einer, bricht
der Start mit einer klaren Meldung ab.

`JWT_SECRET` signiert den State des Admin-Consent-Rueckrufs. Lokal reicht
der Beispielwert; fuer alles andere: `openssl rand -base64 32`.

## Starten

```powershell
docker-compose up -d
npm install
npm run build --workspace=@zerostress/types --workspace=@zerostress/core
npm run db:push
npm run dev --workspace=@zerostress/api     # Fenster 1, Port 3001
npm run dev --workspace=@zerostress/web     # Fenster 2, Port 3002
```

Die API laedt `@zerostress/core` und `@zerostress/types` aus deren `dist/`
(nicht im Git). **Nach jedem `git pull`, das `packages/` beruehrt, den
Build-Befehl wiederholen**, sonst laeuft die API mit altem Core-Code.
Wer an Core arbeitet, startet zusaetzlich
`npm run dev --workspace=@zerostress/core` (tsc im Watch-Modus).

Erwartete erste Zeile der API:
`Environment: <pfad>\.env.local (DEV_AUTH_BYPASS active)`

## DEV_AUTH_BYPASS

Mit `DEV_AUTH_BYPASS=true` und `NEXT_PUBLIC_DEV_AUTH_BYPASS=true` entfaellt
der Entra-Login. Die API legt dafuer einen persistenten Benutzer
`dev@localhost` (Rolle `owner`) in der Default-MSP an, damit Jobs und
Audit-Eintraege gueltige Fremdschluessel haben. In Production verweigert die
API den Start, wenn der Bypass aktiv ist.

## App-Registrierung (Partnertenant)

Entra ID > App-Registrierungen > Neue Registrierung:

| Einstellung | Wert |
|---|---|
| Unterstuetzte Kontotypen | Konten in einem beliebigen Organisationsverzeichnis (mandantenfaehig) |
| Plattform | **Web** (nicht SPA, nicht Mobile/Desktop) |
| Redirect-URIs | `http://localhost:3002/auth/callback` (Login), `http://localhost:3001/auth/consent-callback` (Admin-Consent) |
| Oeffentliche Clientflows | Nein |
| Zertifikate & Geheimnisse | Client-Secret erstellen, Wert in `ENTRA_CLIENT_SECRET` |

Warum Web: Der Browser holt den Authorization Code mit PKCE, das Backend
tauscht ihn mit dem Client-Secret. Bei der Plattform SPA lehnt Entra das
Secret ab (`AADSTS700025`).

### API-Berechtigungen (Application Permissions, Microsoft Graph)

Mindestens `Organization.Read.All` (Verbindungstest). Fuer die Module
zusaetzlich die im jeweiligen Modul-Contract dokumentierten Scopes, z. B.
`User.Read.All`, `Directory.Read.All` fuer Identity. Nach jeder Aenderung an
den Berechtigungen muss der Admin-Consent im Kundentenant erneut erteilt
werden.

## Tenant anbinden

1. In der Konsole unter **Tenants** > **Tenant hinzufuegen**: Anzeigename,
   primaere Domain, Microsoft-Tenant-ID (GUID).
2. **Consent starten**: leitet zum Microsoft-Admin-Consent des Kundentenants
   um. Anmeldung als Global Administrator dieses Tenants. Der Link ist 15
   Minuten gueltig und an deinen Benutzer gebunden.
3. Microsoft ruft `/auth/consent-callback` auf. Die API prueft den
   signierten State, vergleicht den gemeldeten Tenant mit dem registrierten,
   fuehrt den Verbindungstest aus und leitet zurueck auf `/tenants`.
4. **Verbindung testen** kann jederzeit wiederholt werden.

Der erste Testtenant kann der eigene Partnertenant sein. Die
App-Registrierung liegt dort bereits; der Consent erteilt ihr nur die
Application Permissions.

### Verbindungstest: was geprueft wird

| Pruefung | Beweist | Bei Fehlschlag |
|---|---|---|
| Graph `GET /organization` (app-only) | Admin-Consent und Application Permissions | `consent-required` (kein Consent) oder `permissions-insufficient` (Consent ohne passende Berechtigungen) |
| ARM `GET /subscriptions` | Azure-RBAC fuer den Service Principal | Status bleibt `connected`, Hinweis unter "Eingeschraenkter Zugriff" |

### Azure-RBAC fuer AVD

AVD laeuft ueber Azure Resource Manager, nicht ueber Graph. Im Kundentenant
muss der Service Principal der App-Registrierung (erscheint dort nach dem
Consent unter Enterprise-Anwendungen) auf der AVD-Subscription oder
Ressourcengruppe folgende Rollen erhalten:

- `Reader`
- `Desktop Virtualization Contributor`

Ohne diese Zuweisung sieht die Konsole keine Host Pools; der
Verbindungstest meldet dann `0 Azure-Subscription(s) sichtbar`.

## Haeufige Fehler

| Meldung | Ursache | Loesung |
|---|---|---|
| `AADSTS900144: client_id missing` | ENV nicht geladen | Erste Startzeile pruefen, `.env.local` muss im Root liegen |
| `AADSTS700025: Client is public` | Redirect-URI unter SPA/Mobile registriert | Auf Plattform Web umziehen |
| `AADSTS700016: Application not found in directory` | Kein Consent im Kundentenant | Consent starten |
| Graph 403 bei `/organization` | Consent ohne Application Permissions | `Organization.Read.All` hinzufuegen, Consent wiederholen |
| `invalid input syntax for type uuid` | Alter Dev-Bypass mit Dummy-IDs | `git pull`, API neu starten |
