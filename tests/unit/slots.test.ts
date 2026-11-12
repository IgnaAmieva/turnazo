import { describe, expect, it } from "vitest";
import {
  generateSlots,
  mendozaToUtc,
  parseTstzrange,
  todayInMendoza,
  weekdayInMendoza,
} from "@/lib/slots";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("mendozaToUtc", () => {
  it("convierte 08:00 Mendoza a 11:00 UTC", () => {
    const d = mendozaToUtc("2026-11-12", "08:00:00");
    expect(d.toISOString()).toBe("2026-11-12T11:00:00.000Z");
  });

  it("convierte 00:00 Mendoza a 03:00 UTC del mismo día", () => {
    const d = mendozaToUtc("2026-11-12", "00:00:00");
    expect(d.toISOString()).toBe("2026-11-12T03:00:00.000Z");
  });

  it("convierte 23:00 Mendoza a 02:00 UTC del día siguiente", () => {
    const d = mendozaToUtc("2026-11-12", "23:00:00");
    expect(d.toISOString()).toBe("2026-11-13T02:00:00.000Z");
  });
});

describe("parseTstzrange", () => {
  it("parsea formato con corchetes y comillas", () => {
    const r = parseTstzrange('["2026-11-12T13:00:00+00:00","2026-11-12T14:30:00+00:00")');
    expect(r.start.toISOString()).toBe("2026-11-12T13:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-12T14:30:00.000Z");
  });

  it("parsea formato sin comillas", () => {
    const r = parseTstzrange("[2026-11-12T13:00:00+00:00,2026-11-12T14:30:00+00:00)");
    expect(r.start.toISOString()).toBe("2026-11-12T13:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-12T14:30:00.000Z");
  });
});

describe("weekdayInMendoza", () => {
  it("2026-11-12 es jueves (4)", () => {
    expect(weekdayInMendoza("2026-11-12")).toBe(4);
  });
  it("2026-11-15 es domingo (0)", () => {
    expect(weekdayInMendoza("2026-11-15")).toBe(0);
  });
});

describe("todayInMendoza", () => {
  it("devuelve formato YYYY-MM-DD", () => {
    expect(todayInMendoza()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// generateSlots
// ---------------------------------------------------------------------------

const BASE_DATE = "2026-11-12"; // jueves

// 08:00–11:00 → exactamente 2 slots de 90 min (08:00-09:30, 09:30-11:00)
const HOURS_90 = [
  { weekday: 4, open_time: "08:00:00", close_time: "11:00:00" },
];

describe("generateSlots — sin reservas", () => {
  it("genera slots de 90 min de 08:00 a 11:00 (2 slots exactos)", () => {
    const slots = generateSlots({
      date: BASE_DATE,
      hours: HOURS_90,
      slotMinutes: 90,
      booked: [],
      prices: [],
    });
    expect(slots).toHaveLength(2);
    expect(slots[0].start.toISOString()).toBe("2026-11-12T11:00:00.000Z"); // 08:00 Mendoza
    expect(slots[0].end.toISOString()).toBe("2026-11-12T12:30:00.000Z");   // 09:30 Mendoza
    expect(slots[1].start.toISOString()).toBe("2026-11-12T12:30:00.000Z"); // 09:30 Mendoza
    expect(slots[1].end.toISOString()).toBe("2026-11-12T14:00:00.000Z");   // 11:00 Mendoza
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it("no genera slot incompleto al final", () => {
    // 08:00–10:00 con slots de 90 min → 1 slot (08:00-09:30); 09:30+90=11:00 > 10:00
    const slots = generateSlots({
      date: BASE_DATE,
      hours: [{ weekday: 4, open_time: "08:00:00", close_time: "10:00:00" }],
      slotMinutes: 90,
      booked: [],
      prices: [],
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].start.toISOString()).toBe("2026-11-12T11:00:00.000Z");
  });
});

describe("generateSlots — con reservas", () => {
  // Reserva que ocupa el primer slot exactamente
  const booked1 = [
    {
      start: mendozaToUtc(BASE_DATE, "08:00:00"),
      end:   mendozaToUtc(BASE_DATE, "09:30:00"),
    },
  ];

  it("marca el primer slot como ocupado cuando hay reserva exacta", () => {
    const slots = generateSlots({
      date: BASE_DATE,
      hours: HOURS_90,
      slotMinutes: 90,
      booked: booked1,
      prices: [],
    });
    expect(slots[0].available).toBe(false);
    expect(slots[1].available).toBe(true);
  });

  it("solapamiento parcial también ocupa el slot", () => {
    // Reserva que empieza en la mitad del primer slot
    const booked = [
      {
        start: mendozaToUtc(BASE_DATE, "09:00:00"),
        end:   mendozaToUtc(BASE_DATE, "09:30:00"),
      },
    ];
    const slots = generateSlots({
      date: BASE_DATE,
      hours: HOURS_90,
      slotMinutes: 90,
      booked,
      prices: [],
    });
    expect(slots[0].available).toBe(false);
  });

  it("reserva en otro horario no afecta slots fuera de rango", () => {
    const booked = [
      {
        start: mendozaToUtc(BASE_DATE, "15:00:00"),
        end:   mendozaToUtc(BASE_DATE, "16:30:00"),
      },
    ];
    const slots = generateSlots({
      date: BASE_DATE,
      hours: HOURS_90,
      slotMinutes: 90,
      booked,
      prices: [],
    });
    expect(slots.every((s) => s.available)).toBe(true);
  });
});

describe("generateSlots — precios", () => {
  const prices = [
    { weekday: 4, from_time: "08:00:00", to_time: "14:00:00", price: 4000 },
    { weekday: 4, from_time: "14:00:00", to_time: "23:00:00", price: 6000 },
  ];

  it("asigna el precio correcto según la franja horaria", () => {
    const slots = generateSlots({
      date: BASE_DATE,
      hours: [{ weekday: 4, open_time: "08:00:00", close_time: "23:00:00" }],
      slotMinutes: 90,
      booked: [],
      prices,
    });
    // 08:00 Mendoza cae en la primera franja → precio 4000
    expect(slots[0].price).toBe(4000);
    // 14:00 Mendoza cae en la segunda franja → precio 6000
    const slot1400 = slots.find(
      (s) => s.start.getTime() === mendozaToUtc(BASE_DATE, "14:00:00").getTime()
    );
    expect(slot1400?.price).toBe(6000);
  });

  it("devuelve null cuando no hay precio configurado", () => {
    const slots = generateSlots({
      date: BASE_DATE,
      hours: HOURS_90,
      slotMinutes: 90,
      booked: [],
      prices: [],
    });
    expect(slots.every((s) => s.price === null)).toBe(true);
  });
});

describe("generateSlots — múltiples tramos horarios", () => {
  it("genera slots de dos tramos separados en el mismo día", () => {
    // 08:00-11:00 → 2 slots; 17:00-20:30 → 2 slots (17:00-18:30, 18:30-20:00)
    const hours = [
      { weekday: 4, open_time: "08:00:00", close_time: "11:00:00" },
      { weekday: 4, open_time: "17:00:00", close_time: "20:30:00" },
    ];
    const slots = generateSlots({ date: BASE_DATE, hours, slotMinutes: 90, booked: [], prices: [] });
    expect(slots).toHaveLength(4); // 2 mañana + 2 tarde
    // Verificar que están ordenados
    expect(slots[0].start < slots[1].start).toBe(true);
    expect(slots[2].start < slots[3].start).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateSlots — medianoche (migration 008)
// ---------------------------------------------------------------------------

describe("generateSlots — cruce de medianoche", () => {
  it("genera 1 slot de 90 min para horario 23:00-00:30", () => {
    // 23:00-00:30 = 90 min → exactamente 1 slot
    const hours = [{ weekday: 4, open_time: "23:00:00", close_time: "00:30:00" }];
    const slots = generateSlots({
      date: BASE_DATE,
      hours,
      slotMinutes: 90,
      booked: [],
      prices: [],
    });
    expect(slots).toHaveLength(1);
    // 23:00 Mendoza 2026-11-12 = 02:00 UTC 2026-11-13
    expect(slots[0].start.toISOString()).toBe("2026-11-13T02:00:00.000Z");
    // 00:30 Mendoza 2026-11-13 = 03:30 UTC 2026-11-13
    expect(slots[0].end.toISOString()).toBe("2026-11-13T03:30:00.000Z");
    expect(slots[0].available).toBe(true);
  });

  it("genera 4 slots de 60 min para horario 22:00-02:00 con precio 22:00-02:00", () => {
    // 22:00-02:00 = 240 min → 4 slots de 60 min
    const hours  = [{ weekday: 4, open_time: "22:00:00", close_time: "02:00:00" }];
    const prices = [{ weekday: 4, from_time: "22:00:00", to_time: "02:00:00", price: 9000 }];
    const slots = generateSlots({
      date: BASE_DATE,
      hours,
      slotMinutes: 60,
      booked: [],
      prices,
    });
    expect(slots).toHaveLength(4);
    // Todos deben tener precio 9000
    expect(slots.every((s) => s.price === 9000)).toBe(true);
    // Primer slot: 22:00 Mendoza = 01:00 UTC del día siguiente
    expect(slots[0].start.toISOString()).toBe("2026-11-13T01:00:00.000Z");
    // Último slot: 01:00 Mendoza 2026-11-13 = 04:00 UTC 2026-11-13
    expect(slots[3].start.toISOString()).toBe("2026-11-13T04:00:00.000Z");
  });

  it("asigna precio correcto para franja 18:00-00:00 en slot de 23:00", () => {
    // Precio: 18:00-00:00 (medianoche exacta como cierre)
    const hours  = [{ weekday: 4, open_time: "14:00:00", close_time: "00:00:00" }];
    const prices = [{ weekday: 4, from_time: "18:00:00", to_time: "00:00:00", price: 8000 }];
    const slots = generateSlots({
      date: BASE_DATE,
      hours,
      slotMinutes: 60,
      booked: [],
      prices,
    });
    // Verificar que el slot de 23:00 tiene precio 8000
    const slot23 = slots.find(
      (s) => s.start.getTime() === mendozaToUtc(BASE_DATE, "23:00:00").getTime()
    );
    expect(slot23).toBeDefined();
    expect(slot23!.price).toBe(8000);
  });
});
