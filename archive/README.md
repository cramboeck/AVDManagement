# Archiv

## legacy-main-2026-06-02-07c89ac.zip

Stand des Branches `main` vor der Abloesung durch ZeroStress Cockpit: das
fruehere "Cloud Management Portal" (PowerShell/Pode, Docker) mit den
Autopilot-Skripten.

| Feld | Wert |
|---|---|
| Quelle | `origin/main`, Commit `07c89ac` vom 2026-06-02 |
| Erzeugt mit | `git archive --format=zip --prefix=legacy-main/ origin/main` |
| Inhalt | 41 Dateien, alle Inhalte des Commits ohne Git-Historie |
| SHA-256 | `2d503e732917e2f12f1096789d0f1ba8601c5b81e33e559de8b09e7f1d25afd4` |

Geprueft vor dem Ablegen: keine echten Zugangsdaten, nur Platzhalter in
`config/appsettings.example.json`.

Pruefen unter Windows:

```powershell
(Get-FileHash .\archive\legacy-main-2026-06-02-07c89ac.zip -Algorithm SHA256).Hash
```

Das Archiv enthaelt Dateien und keine Historie. Die vollstaendige Historie
bleibt nur erhalten, solange der Commit `07c89ac` ueber einen Branch oder
Tag erreichbar ist.
