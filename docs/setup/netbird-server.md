# Betrieb auf eigenem Server, nur ueber NetBird erreichbar

Ziel: die Konsole laeuft dauerhaft auf einem Server des MSP und ist
ausschliesslich ueber das NetBird-VPN erreichbar. Kein Port ist aus dem
Internet offen. Diese Anleitung ergaenzt
[production-hardening.md](production-hardening.md) (Entra-Trennung,
Conditional Access, Pruefliste) und ersetzt dort den Teil "Reverse Proxy
im Internet".

Beispielsystem: Ubuntu Server 24.04 LTS als VM, 4 vCPU, 8 GB RAM, 60 GB
SSD. Hostname im Folgenden `cockpit.intern.example.de`; durch den eigenen
Namen ersetzen.

```
 Techniker-PC (NetBird)                      Server (NetBird, kein offener Port)
 Browser ── wt0 ── NetBird-Tunnel ── wt0 ── Caddy :443 ──┬── Web 127.0.0.1:3002
                                                          └── API 127.0.0.1:3001
 Build-Worker (NetBird) ── Tunnel ──────────────────────────┘      │
                                                     Postgres/Redis 127.0.0.1
                                           ausgehend: Microsoft-APIs, Key Vault
```

## 1. NetBird

Im NetBird-Dashboard:

1. **Gruppen** anlegen: `cockpit-server`, `cockpit-admins`,
   `cockpit-workers`.
2. **Setup-Key** fuer den Server: einmalig verwendbar, kurze Laufzeit,
   automatische Gruppe `cockpit-server`.
3. **Zugriffsrichtlinien:** die Standardrichtlinie "Default" (alle mit
   allen) deaktivieren, falls noch aktiv. Dann:
   - `cockpit-admins` -> `cockpit-server`, TCP 443
   - `cockpit-workers` -> `cockpit-server`, TCP 443
   - `cockpit-admins` -> `cockpit-server`, TCP 22 (nur fuer die Wartung)
4. **Posture Checks** fuer die Richtlinie der Admins, soweit verfuegbar:
   Mindestversion des NetBird-Clients und des Betriebssystems.
5. Nur Techniker-Geraete in `cockpit-admins`; der Build-Worker in
   `cockpit-workers`.

Auf dem Server:

```bash
curl -fsSL https://pkgs.netbird.io/install.sh | sh
sudo netbird up --setup-key <SETUP-KEY>
netbird status          # zeigt die NetBird-IP (100.x.y.z) und das Interface wt0
```

## 2. Firewall

Eingehend nur ueber das NetBird-Interface; SSH ebenfalls nur dort.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on wt0 to any port 443 proto tcp
sudo ufw allow in on wt0 to any port 22 proto tcp
sudo ufw enable
sudo ufw status verbose
```

Vorher pruefen, dass die SSH-Sitzung ueber NetBird laeuft, sonst sperrt man
sich aus. Docker veroeffentlicht Ports an ufw vorbei; `docker-compose.yml`
bindet Postgres und Redis deshalb nur an 127.0.0.1. Diese Zeilen nicht
aendern.

## 3. Software

```bash
sudo apt update && sudo apt install -y git ca-certificates curl
# Node.js 22 LTS (Node 20 ist seit April 2026 ohne Sicherheitsupdates)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
# Docker fuer Postgres und Redis
curl -fsSL https://get.docker.com | sudo sh
# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Eigenen Systembenutzer anlegen, Code dort auschecken:

```bash
sudo useradd --system --create-home --home-dir /opt/zerostress --shell /usr/sbin/nologin zerostress
sudo -u zerostress git clone https://github.com/cramboeck/AVDManagement.git /opt/zerostress/app
cd /opt/zerostress/app && sudo -u zerostress git checkout <branch>
```

Fuer ein privates Repository ein Deploy-Key mit Nur-Lese-Zugriff, kein
persoenliches Token.

## 4. Name und Zertifikat

Der Browser braucht einen Namen und ein vertrauenswuerdiges Zertifikat.
Zwei Wege:

**A, empfohlen: eigene Subdomain mit Let's Encrypt per DNS-01.** Im
oeffentlichen DNS einen A-Record `cockpit.intern.example.de` auf die
NetBird-IP des Servers. Die Adresse ist privat (100.64.0.0/10) und aus dem
Internet nicht erreichbar; sie preiszugeben ist unkritisch. Let's Encrypt
prueft per DNS-Eintrag, nicht per Verbindung. Caddy braucht dafuer das
Modul des DNS-Anbieters (Build mit `xcaddy` oder Download unter
caddyserver.com/download mit Modul, z. B. Cloudflare, Hetzner, INWX). Das
API-Token des DNS-Anbieters auf das eine DNS-Zone beschraenken.

**B: interne CA von Caddy.** `tls internal` im Caddyfile. Caddy erzeugt
eine eigene Stamm-CA; deren Zertifikat
(`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`) auf
jedem Techniker-PC als vertrauenswuerdige Stammzertifizierungsstelle
installieren (Windows: `certutil -addstore -f Root root.crt` als Admin,
oder per Intune-Zertifikatprofil). Der Name muss trotzdem aufloesbar sein,
etwa ueber den A-Record aus Weg A oder die DNS-Verwaltung von NetBird.

`/etc/caddy/Caddyfile` (Weg A mit Cloudflare als Beispiel):

```
cockpit.intern.example.de {
    tls {
        dns cloudflare {env.CF_API_TOKEN}
    }
    encode zstd gzip

    handle_path /api/* {
        reverse_proxy 127.0.0.1:3001 {
            header_up X-Forwarded-For {remote_host}
        }
    }
    handle {
        reverse_proxy 127.0.0.1:3002
    }
}
```

Das Token gehoert in eine Datei, die nur root lesen kann, z. B.
`/etc/caddy/caddy.env` mit `CF_API_TOKEN=...` und `EnvironmentFile=` im
Override (`sudo systemctl edit caddy`). Danach
`sudo systemctl reload caddy`.

## 5. Konfiguration

`/opt/zerostress/app/.env.local`, Eigentuemer `zerostress`, Rechte 600.
Ausgangspunkt ist `.env.example`; abweichend vom Laborstand:

```
NODE_ENV=production
API_HOST=127.0.0.1
NEXT_PUBLIC_APP_URL=https://cockpit.intern.example.de
NEXT_PUBLIC_API_URL=https://cockpit.intern.example.de/api
API_URL=https://cockpit.intern.example.de/api
TRUST_PROXY=true
DEV_AUTH_BYPASS=false
NEXT_PUBLIC_DEV_AUTH_BYPASS=false
DATABASE_URL=postgresql://zerostress:<passwort>@127.0.0.1:5432/zerostress
REDIS_URL=redis://127.0.0.1:6379
KEY_VAULT_URL=https://<vault>.vault.azure.net
# Fuer die Startphase bei Kunden, siehe read-only-mode.md
# CONSOLE_READ_ONLY=true
```

**Secrets aus dem Key Vault, nicht aus der Datei.** Auf einem eigenen
Server gibt es keine Managed Identity von Azure. Dafuer den Server mit
**Azure Arc** verbinden (Azure Connected Machine Agent); er bekommt eine
eigene verwaltete Identitaet, die `DefaultAzureCredential` der API
verwendet. Dieser Identitaet im Key Vault nur "Key Vault Secrets User"
geben. In den Vault: `ENTRA-CLIENT-CERTIFICATE-PEM`, `JWT-SECRET`,
`RESULT-ENCRYPTION-KEY`, `WORKER-TOKEN` und weitere Secrets, die genutzt
werden. Damit liegt auf dem Server kein Zugangsschluessel im Klartext.

Postgres-Passwort fuer Docker in `/opt/zerostress/compose.env`
(`POSTGRES_PASSWORD=...`, Rechte 600) und beim Start mitgeben:

```bash
cd /opt/zerostress/app
sudo docker compose --env-file /opt/zerostress/compose.env up -d
```

## 6. Bauen und als Dienst starten

```bash
cd /opt/zerostress/app
sudo -u zerostress npm ci
sudo -u zerostress npm run build --workspace=@zerostress/types
sudo -u zerostress npm run build --workspace=@zerostress/core
sudo -u zerostress npm run build --workspace=@zerostress/api
sudo -u zerostress npm run build --workspace=@zerostress/web
sudo -u zerostress npm run db:push
sudo -u zerostress npm run db:harden
```

`/etc/systemd/system/zerostress-api.service`:

```ini
[Unit]
Description=ZeroStress Cockpit API
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=zerostress
WorkingDirectory=/opt/zerostress/app/apps/api
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/zerostress/app/apps/api/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/zerostress-web.service`:

```ini
[Unit]
Description=ZeroStress Cockpit Web
After=network-online.target

[Service]
User=zerostress
WorkingDirectory=/opt/zerostress/app/apps/web
ExecStart=/usr/bin/npx next start -H 127.0.0.1 -p 3002
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/zerostress/app/apps/web/.next
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /opt/zerostress/app/apps/api/data && sudo chown zerostress /opt/zerostress/app/apps/api/data
sudo systemctl daemon-reload
sudo systemctl enable --now zerostress-api zerostress-web
journalctl -u zerostress-api -n 50
```

`apps/api/data` haelt die Paketablage (`ARTIFACT_STORE=local`); ist
`ARTIFACT_STORE_PATH` anders gesetzt, `ReadWritePaths` anpassen.

## 7. Entra und Consent

- Login-Registrierung: Redirect-URI
  `https://cockpit.intern.example.de/auth/callback`. Microsoft akzeptiert
  private Namen, weil der Browser die Weiterleitung ausfuehrt.
- Tenant-Registrierung: Redirect-URI
  `https://cockpit.intern.example.de/api/auth/consent-callback`.
- **Consent durch den Kunden-Admin:** Nach dem Consent leitet Microsoft
  dessen Browser auf die Konsole zurueck. Ohne NetBird erreicht er sie
  nicht und sieht eine Fehlerseite. Der Consent ist trotzdem erteilt. In
  der Konsole danach **Verbindung testen**; der Status wechselt auf
  "Verbunden". Den Kunden vorab darauf hinweisen oder den Consent
  gemeinsam am Techniker-PC durchfuehren.

## 8. Worker

- Build-Worker (`apps/worker-windows`): NetBird installieren, in die Gruppe
  `cockpit-workers`, in der Konfiguration
  `apiUrl = https://cockpit.intern.example.de/api`, kein
  `allowInsecureHttp`. Bei Weg B die Caddy-Stamm-CA auch dort installieren.
- Exchange-Worker: genauso.

## 9. Sicherung

Taeglich die Datenbank sichern, verschluesselt und ausserhalb des Servers:

```bash
sudo docker exec zerostress-postgres pg_dump -U zerostress -Fc zerostress > /var/backups/zerostress-$(date +%F).dump
```

Als systemd-Timer oder Cronjob, danach verschluesselt (z. B. `restic` mit
eigenem Repository) auf ein Ziel ausserhalb des Servers. Das Audit-Log ist
Teil der Datenbank; Aufbewahrung mindestens ein Jahr. Einmal eine
Wiederherstellung in eine Testdatenbank proben.

## 10. Aktualisieren

```bash
cd /opt/zerostress/app
sudo -u zerostress git pull
sudo -u zerostress npm ci
sudo -u zerostress npm run build --workspace=@zerostress/types
sudo -u zerostress npm run build --workspace=@zerostress/core
sudo -u zerostress npm run build --workspace=@zerostress/api
sudo -u zerostress npm run build --workspace=@zerostress/web
sudo -u zerostress npm run db:push      # bei "data-loss statements" abbrechen, siehe local-development.md
sudo systemctl restart zerostress-api zerostress-web
```

Ubuntu-Sicherheitsupdates automatisch (`unattended-upgrades`), NetBird und
Caddy kommen ueber ihre Paketquellen mit.

## 11. Pruefen

- [ ] Ohne NetBird: `https://cockpit.intern.example.de` ist nicht
      erreichbar, auch nicht ueber die oeffentliche IP des Servers
      (`nmap` von aussen: keine offenen Ports).
- [ ] Mit NetBird aus `cockpit-admins`: Login klappt, Zertifikat gueltig.
- [ ] Ein NetBird-Geraet ausserhalb der Gruppen erreicht Port 443 nicht.
- [ ] `ss -tlnp` auf dem Server: 3001, 3002, 5432, 6379 nur auf 127.0.0.1.
- [ ] `GET /api/health` liefert `status: ok`, kein `schema.missing`.
- [ ] Erste Logzeile der API ohne `DEV_AUTH_BYPASS`, mit `Key Vault: loaded ...`.
- [ ] Build-Worker verbindet sich; unter Einstellungen > Worker-Token ist "letzte Nutzung" aktuell.
- [ ] Die Pruefliste in production-hardening.md, Abschnitt 5.
