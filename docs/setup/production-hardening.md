# Produktivbetrieb: Entra, Conditional Access, Reverse Proxy

Diese Anleitung fuehrt vom Laborstand (localhost, Dev-Bypass) zu einem
Setup, das ueber das Internet erreichbar sein darf. Reihenfolge einhalten:
erst Anmeldung und Zugriffsschutz, dann TLS und Proxy, zuletzt
Veroeffentlichung. Alle Schritte sind Konfiguration; der Code ist dafuer
vorbereitet (siehe `local-development.md`, Abschnitte "Anmeldung und
Sitzung", "Sicherheits-Header", "Audit-Log unveraenderlich", "Secrets aus
Key Vault").

## 1. App-Registrierungen trennen

Zwei Registrierungen im Partnertenant, damit der Login der Konsole und der
Zugriff auf Kundentenants getrennte Berechtigungen und getrennte
Anmeldedaten haben:

| Registrierung | Kontotyp | Zweck | Variablen |
|---|---|---|---|
| **ZeroStress Cockpit Login** | Nur dieses Organisationsverzeichnis (single-tenant) | Anmeldung der Techniker an der Konsole | `ENTRA_LOGIN_CLIENT_ID`, `NEXT_PUBLIC_ENTRA_LOGIN_CLIENT_ID`, optional `ENTRA_LOGIN_CLIENT_SECRET` |
| **ZeroStress Cockpit Tenants** | Mandantenfaehig (multi-tenant) | app-only-Zugriff auf Kundentenants nach Admin-Consent | `ENTRA_CLIENT_ID`, Zertifikat oder `ENTRA_CLIENT_SECRET` |

Ohne die Login-Variablen nutzt die Konsole die Tenant-Registrierung auch
fuer den Login (Laborstand). Fuer die Login-Registrierung:

1. Plattform **Web**, Redirect-URI `https://<host>/auth/callback`. Keine
   SPA-Plattform, kein impliziter Flow, keine oeffentlichen Clientflows.
2. API-Berechtigungen: nur `openid`, `profile`, `email`, `User.Read`
   (delegiert). Keine Anwendungsberechtigungen.
3. Anmeldedaten: bevorzugt dasselbe Zertifikat wie die Tenant-Registrierung
   (dann keine weitere Variable noetig), sonst ein eigenes Client-Secret in
   `ENTRA_LOGIN_CLIENT_SECRET`.
4. **Unternehmensanwendung** der Login-Registrierung: Eigenschaften,
   "Zuweisung erforderlich" auf Ja. Danach unter Benutzer und Gruppen nur
   die Gruppe der Techniker zuweisen. Wer nicht zugewiesen ist, kommt nicht
   bis zur Konsole, unabhaengig von der Rolle in der Konsole.

Fuer die Tenant-Registrierung bleibt alles wie in `local-development.md`
(Anwendungsberechtigungen laut Modul-Contracts, Admin-Consent je Kunde,
Redirect-URI `https://<host>/api/auth/consent-callback`). Vor dem Verkauf
an andere MSPs: Publisher Verification (Partner-Center-Kennung), sonst
warnt Entra beim Consent.

## 2. Conditional Access fuer die Login-App

Richtlinie im Partnertenant, Ziel: nur die Login-Registrierung.

- Benutzer: Gruppe der Techniker; Break-Glass-Konten ausschliessen.
- Zielressource: die Login-App.
- Gewaehren: **Authentifizierungsstaerke "Phishingresistente MFA"**
  (Passkey/FIDO2, Windows Hello for Business, zertifikatbasiert) und
  **konformes Geraet** (Intune) oder hybrid eingebundenes Geraet.
- Sitzung: Anmeldehaeufigkeit 12 Stunden, persistente Browsersitzung aus.
  Das passt zur Konsolen-Sitzung (`SESSION_TTL_HOURS=12`).
- Zweite Richtlinie: Zugriff aus nicht vertrauenswuerdigen Standorten
  blockieren, wenn der MSP nur aus bekannten Netzen arbeitet.

Im Bericht-Modus starten, Anmeldeprotokoll pruefen, dann scharf schalten.
Ohne Conditional Access reicht ein gestohlenes Passwort plus SMS-Code fuer
Adminrechte auf allen Kundentenants.

## 3. TLS und Reverse Proxy

Web und API laufen hinter einem Proxy unter **einem Host**, damit das
Sitzungscookie same-site bleibt und nur ein Zertifikat noetig ist. Beispiel
mit Caddy (automatisches Zertifikat per Let's Encrypt fuer oeffentliche
Namen; intern `tls internal` oder eigene PKI):

```
cockpit.example.com {
    encode zstd gzip

    # API unter /api, Praefix wird entfernt (die API kennt kein /api)
    handle_path /api/* {
        reverse_proxy 127.0.0.1:3001 {
            header_up X-Forwarded-For {remote_host}
        }
    }

    # Alles andere ist das Web
    handle {
        reverse_proxy 127.0.0.1:3002
    }
}
```

Konfiguration dazu:

```
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://cockpit.example.com
NEXT_PUBLIC_API_URL=https://cockpit.example.com/api
API_URL=https://cockpit.example.com/api
TRUST_PROXY=true
DEV_AUTH_BYPASS=false
NEXT_PUBLIC_DEV_AUTH_BYPASS=false
```

- `API_URL` bestimmt die Redirect-URI fuer den Admin-Consent.
- `TRUST_PROXY=true` nur hinter dem Proxy; sonst koennte ein Client seine
  IP fuer die Rate-Limits selbst setzen.
- Firewall: nur 443 eingehend; 3001 und 3002 bleiben auf 127.0.0.1.
- Worker: `apiUrl` auf `https://cockpit.example.com/api`, kein
  `allowInsecureHttp`.
- HSTS setzt die API und das Web in Produktion automatisch.

## 4. Datenbank, Redis, Secrets

- Postgres und Redis nur im privaten Netz, TLS erzwungen, Redis mit
  Passwort. `DATABASE_URL` und `REDIS_URL` mit den Zugangsdaten aus dem
  Key Vault (App-Service-Referenz) oder Managed-Identity-Login.
- `npm run db:push` und danach `npm run db:harden` (Trigger fuer das
  Audit-Log). Eigene API-Rolle nach dem Muster in `apps/api/db/harden.sql`.
- Alle uebrigen Secrets im Key Vault (`KEY_VAULT_URL`), Zertifikat statt
  Client-Secret fuer die Tenant-Registrierung.
- Backups taeglich, Restore einmal geprobt, Aufbewahrung des Audit-Logs
  festlegen (mindestens ein Jahr).

## 5. Vor dem Freischalten pruefen

- [ ] Login nur mit zugewiesenem Konto moeglich, Conditional Access greift
      (Test mit einem Konto ohne Passkey muss scheitern).
- [ ] `GET /health` ohne `schema.missing`, `status: ok`.
- [ ] Audit-Seite: "Kette pruefen" meldet in Ordnung.
- [ ] Engineer-Konto sieht nur zugewiesene Tenants; fremde Tenant-Id
      antwortet mit 404.
- [ ] Rate-Limit greift: 25 Logins in einer Minute liefern 429.
- [ ] Response-Header pruefen: CSP, HSTS, X-Frame-Options, kein
      `X-Powered-By`.
- [ ] `DEV_AUTH_BYPASS` in keiner Umgebung gesetzt; die API verweigert den
      Start sonst in Produktion.
- [ ] MCP-Endpunkt: nur freischalten, wenn ein Client ihn braucht.
- [ ] Penetrationstest durch Dritte vor dem ersten Kundentenant.
