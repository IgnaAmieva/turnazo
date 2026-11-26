import { describe, expect, it } from "vitest";
import { buildPushPayload } from "@/lib/push";
import { actionsFor, ownerWhatsAppText, venueStatus, VENUE_STATUSES } from "@/lib/venue-status";

describe("push al dueño cuando el superadmin decide (028)", () => {
  it("venue_approved: título y texto con el nombre del complejo; abre sus complejos", () => {
    const p = buildPushPayload("venue_approved", { venue_name: "Club Norte", reason: null });
    expect(p.title).toBe("Tu complejo fue aprobado");
    expect(p.body).toBe("Club Norte ya está publicado: los jugadores pueden encontrarlo y reservar.");
    expect(p.url).toBe("/panel/complejos");
  });

  it("venue_rejected: lleva el motivo", () => {
    const p = buildPushPayload("venue_rejected", { venue_name: "Club Norte", reason: "Falta la dirección" });
    expect(p.title).toBe("Tu complejo no fue aprobado");
    expect(p.body).toBe("Club Norte: Falta la dirección");
    expect(p.url).toBe("/panel/complejos");
  });

  it("otros tipos siguen igual", () => {
    expect(buildPushPayload("x", {}).title).toBe("Depoturnos");
  });
});

describe("estados y acciones (iguales a superadmin_set_venue_status)", () => {
  it("cuatro estados con etiqueta", () => {
    expect(VENUE_STATUSES.map((s) => venueStatus(s).label)).toEqual(["Pendiente", "Aprobado", "Suspendido", "Rechazado"]);
    expect(venueStatus("raro").label).toBe("Pendiente");
  });

  it("acciones por estado", () => {
    expect(actionsFor("pending")).toEqual(["approve", "reject"]);
    expect(actionsFor("approved")).toEqual(["suspend"]);
    expect(actionsFor("suspended")).toEqual(["reactivate"]);
    expect(actionsFor("rejected")).toEqual(["approve"]);
  });

  it("WhatsApp al dueño: aprobado con link al panel; rechazado con el motivo", () => {
    expect(ownerWhatsAppText("approve", "Club Norte", "https://x/panel")).toContain("Club Norte ya está aprobado en Depoturnos");
    expect(ownerWhatsAppText("approve", "Club Norte", "https://x/panel")).toContain("https://x/panel");
    expect(ownerWhatsAppText("reject", "Club Norte", "https://x/panel", "Falta la dirección")).toContain("Motivo: Falta la dirección.");
  });
});
