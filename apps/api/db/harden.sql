-- ZeroStress Cockpit: Audit-Log gegen Aenderung und Loeschung sichern
--
-- Ausfuehren mit: npm run db:harden (liest DATABASE_URL) oder direkt per psql.
-- Idempotent: mehrfaches Ausfuehren ist unschaedlich.
--
-- 1) Trigger: UPDATE und DELETE auf audit_entries schlagen fehl, egal mit
--    welcher Rolle die Verbindung laeuft. TRUNCATE ebenfalls.
-- 2) Empfehlung fuer Produktion: die API mit einer eigenen Rolle betreiben,
--    die auf audit_entries nur INSERT und SELECT hat (siehe unten,
--    auskommentiert, weil der Rollenname je Installation anders ist).

CREATE OR REPLACE FUNCTION zsc_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_entries is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_entries_no_update ON audit_entries;
CREATE TRIGGER audit_entries_no_update
  BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION zsc_audit_immutable();

DROP TRIGGER IF EXISTS audit_entries_no_truncate ON audit_entries;
CREATE TRIGGER audit_entries_no_truncate
  BEFORE TRUNCATE ON audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION zsc_audit_immutable();

-- Produktion: eigene Rolle fuer die API ohne Schreibrechte auf das Audit-Log
-- ausser INSERT. Der Trigger oben gilt auch fuer den Eigentuemer, die Rolle
-- verhindert zusaetzlich, dass ein kompromittierter API-Prozess den Trigger
-- selbst entfernt (dafuer braucht es den Tabelleneigentuemer).
--
-- CREATE ROLE zerostress_api LOGIN PASSWORD '<aus Key Vault>';
-- GRANT CONNECT ON DATABASE zerostress TO zerostress_api;
-- GRANT USAGE ON SCHEMA public TO zerostress_api;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zerostress_api;
-- REVOKE UPDATE, DELETE, TRUNCATE ON audit_entries FROM zerostress_api;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zerostress_api;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zerostress_api;
