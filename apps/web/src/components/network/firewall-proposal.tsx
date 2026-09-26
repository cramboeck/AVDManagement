"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import { LoadingTable } from "@/components/ui/loading";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { CapabilityNotice } from "@/components/identity/capability-notice";
import { Collapsible } from "@/components/ui/collapsible";
import { formatDateTime } from "@/components/identity/sign-in-table";
import type {
  FirewallProposal,
  FirewallProposalResult,
  FirewallRule,
  FirewallRuleKind,
} from "@zerostress/types";

const kindLabels: Record<FirewallRuleKind, string> = {
  microsoft365: "Microsoft 365",
  microsoft: "Microsoft-Dienste",
  "known-vendor": "Bekannte Hersteller",
  other: "Sonstige Ziele",
};

const kindHints: Record<FirewallRuleKind, string> = {
  microsoft365:
    "Aus der offiziellen Endpunktliste. Optimize direkt und ohne Inspektion, Allow erlauben, Default wie normaler Internetverkehr.",
  microsoft:
    "Updates, Defender, Intune, Anmeldung, Telemetrie. Ohne diese Ziele fallen Verwaltung und Schutz aus.",
  "known-vendor":
    "Hersteller, deren Software auf den Geraeten laeuft. Pruefen, ob der Hersteller erwuenscht ist.",
  other:
    "Nicht zugeordnete Domaenen und nackte IP-Adressen. Hier lohnt der Blick auf Prozess und Geraetezahl.",
};

function toCsv(rules: FirewallRule[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    "Gruppe;Kategorie;Regelname;M365-Kategorie;Erforderlich;Ziele;Ports;Geraete;Verbindungen;Prozesse;Hinweis",
  ];
  for (const r of rules) {
    lines.push(
      [
        kindLabels[r.kind],
        r.kind,
        r.name,
        r.m365Category ?? "",
        r.required === null ? "" : r.required ? "ja" : "nein",
        r.destinations.join(" "),
        r.ports.join(" "),
        String(r.devices),
        String(r.connections),
        r.processes.join(" "),
        r.note ?? "",
      ]
        .map(esc)
        .join(";"),
    );
  }
  return lines.join("\r\n");
}

/**
 * Vorschlag fuer ausgehende Firewall-Regeln aus den externen Zielen der
 * Clients: gruppiert nach Microsoft 365, Microsoft-Diensten, Herstellern und
 * Rest. Nur Anzeige und Export; nichts wird konfiguriert.
 */
export function FirewallProposalPanel({ tenantId }: { tenantId: string }) {
  const [started, setStarted] = useState(false);
  const [days, setDays] = useState(7);
  const query = useQuery({
    queryKey: ["firewall-proposal", tenantId, days],
    queryFn: () =>
      api.get<FirewallProposalResult & { endpointsError?: string | null }>(
        `/tenants/${tenantId}/network/firewall-proposal?days=${days}`,
      ),
    enabled: started,
    staleTime: 10 * 60 * 1000,
  });

  const download = () => {
    if (!query.data?.available) return;
    const blob = new Blob([`﻿${toCsv(query.data.data.rules)}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `firewall-vorschlag-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Regelvorschlag Firewall (ausgehend)</h2>
          <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
            Externe Ziele der Clients, gruppiert nach Microsoft 365 (offizielle
            Endpunktliste mit Kategorie), Microsoft-Diensten, bekannten
            Herstellern und Rest. Je Gruppe Ziele, Ports, Geraete und Prozesse
            als Beleg. Vorschlag zum Pruefen, wird nirgends geschrieben.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} Tage
              </option>
            ))}
          </select>
          <button
            onClick={() => setStarted(true)}
            disabled={started && query.isFetching}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {started
              ? query.isFetching
                ? "Lade..."
                : "Aktualisieren"
              : "Vorschlag erstellen"}
          </button>
          {query.data?.available && (
            <button
              onClick={download}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              CSV
            </button>
          )}
        </div>
      </div>

      {!started ? null : query.isLoading ? (
        <LoadingTable rows={6} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : !query.data ? null : !query.data.available ? (
        <CapabilityNotice
          what="die Verbindungsdaten (Advanced Hunting)"
          reason={query.data.reason}
          missingPermission={query.data.missingPermission}
          detail={query.data.detail}
        />
      ) : query.data.data.rules.length === 0 ? (
        <EmptyState
          title="Keine externen Ziele"
          description="Im Zeitraum wurden keine Verbindungen zu oeffentlichen Adressen gemeldet."
        />
      ) : (
        <ProposalView
          proposal={query.data.data}
          endpointsError={query.data.endpointsError ?? null}
        />
      )}
    </section>
  );
}

function ProposalView({
  proposal,
  endpointsError,
}: {
  proposal: FirewallProposal;
  endpointsError: string | null;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {proposal.totalDestinations} externe Ziele in {proposal.rules.length}{" "}
        Gruppen, Stand {formatDateTime(proposal.generatedAt)}
        {proposal.endpointsVersion
          ? ` · M365-Endpunktliste ${proposal.endpointsVersion}`
          : " · M365-Endpunktliste nicht geladen"}
        {endpointsError ? ` (${endpointsError})` : ""}
        {proposal.unmatchedIps > 0
          ? ` · ${proposal.unmatchedIps} Ziele nur als IP`
          : ""}
      </p>
      {(
        [
          "microsoft365",
          "microsoft",
          "known-vendor",
          "other",
        ] as FirewallRuleKind[]
      ).map((kind) => {
        const rules = proposal.rules.filter((r) => r.kind === kind);
        if (rules.length === 0) return null;
        return (
          <Collapsible
            key={kind}
            summary={`${kindLabels[kind]} (${rules.length})`}
            defaultOpen={kind !== "microsoft365"}
          >
            <p className="mb-2 text-xs text-muted-foreground">
              {kindHints[kind]}
            </p>
            <ul className="divide-y rounded-md border">
              {rules.map((r) => (
                <li key={r.id} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {r.name}
                      {r.required === true && (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                          erforderlich
                        </span>
                      )}
                      {r.required === false && (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          optional
                        </span>
                      )}
                    </span>
                    <span
                      className={clsx(
                        "text-xs tabular-nums",
                        r.kind === "other" && r.devices >= 3 && "text-warning",
                      )}
                    >
                      {r.devices} Geraete ·{" "}
                      {r.connections.toLocaleString("de-DE")} Verbindungen ·
                      Ports {r.ports.join(", ") || "—"}
                    </span>
                  </div>
                  <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                    {r.destinations.join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Prozesse: {r.processes.join(", ") || "—"}
                    {r.note ? ` · ${r.note}` : ""}
                    {r.lastSeen
                      ? ` · zuletzt ${formatDateTime(r.lastSeen)}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Collapsible>
        );
      })}
    </div>
  );
}
