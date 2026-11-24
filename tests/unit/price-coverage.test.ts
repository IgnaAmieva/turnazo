/**
 * Bug de futmates: los turnos de 22:00 y 23:00 salían sin precio.
 * Causa: la cancha abre de 10:00 a 00:00, pero el precio está cargado de
 * 08:00 a 22:00 (la fila que propone el editor de precios por defecto), así
 * que de 22:00 a 00:00 no hay precio y la base rechaza esas reservas
 * (price_not_set). unpricedRanges detecta esos tramos para avisarlos en el
 * panel y no ofrecerlos en la grilla pública.
 */
import { describe, expect, it } from "vitest";
import { defaultPriceRow, unpricedRanges } from "@/lib/price-coverage";

const week = <T extends object>(row: T) => Array.from({ length: 7 }, (_, weekday) => ({ weekday, ...row }));

describe("unpricedRanges", () => {
  it("futmates (10:00–00:00, precio 08:00–22:00, turnos de 60 min): 22:00–00:00 sin precio todos los días", () => {
    const r = unpricedRanges(
      week({ open_time: "10:00:00", close_time: "00:00:00" }),
      week({ from_time: "08:00:00", to_time: "22:00:00", price: 10000 }),
      60,
    );
    expect(r).toHaveLength(7);
    for (const x of r) expect(x).toMatchObject({ from: "22:00", to: "00:00" });
  });

  it("precio que cubre hasta medianoche (to 00:00): nada sin precio", () => {
    expect(unpricedRanges(
      week({ open_time: "10:00:00", close_time: "00:00:00" }),
      [...week({ from_time: "08:00:00", to_time: "22:00:00", price: 10000 }),
       ...week({ from_time: "22:00:00", to_time: "00:00:00", price: 12000 })],
      60,
    )).toEqual([]);
  });

  it("huecos en el medio y un solo día", () => {
    const r = unpricedRanges(
      [{ weekday: 3, open_time: "08:00:00", close_time: "14:00:00" }],
      [{ weekday: 3, from_time: "08:00:00", to_time: "09:30:00", price: 5000 },
       { weekday: 3, from_time: "12:30:00", to_time: "14:00:00", price: 5000 }],
      90,
    );
    expect(r).toEqual([{ weekday: 3, from: "09:30", to: "12:30" }]);
  });
});

describe("defaultPriceRow — 'Agregar franja' en el editor de precios", () => {
  it("futmates: propone el tramo que falta (22:00 a 00:00), no 08:00–22:00 fijo", () => {
    expect(defaultPriceRow(
      week({ open_time: "10:00:00", close_time: "00:00:00" }),
      week({ from_time: "08:00:00", to_time: "22:00:00", price: 10000 }),
      60,
    )).toEqual({ weekday: 0, from_time: "22:00", to_time: "00:00" });
  });

  it("cancha nueva sin precios: el horario de apertura (lunes primero)", () => {
    expect(defaultPriceRow(week({ open_time: "14:00:00", close_time: "00:00:00" }), [], 60))
      .toMatchObject({ from_time: "14:00", to_time: "00:00" });
  });

  it("todo cubierto: el horario de apertura del primer día abierto", () => {
    expect(defaultPriceRow(
      [{ weekday: 6, open_time: "09:00:00", close_time: "13:00:00" }],
      [{ weekday: 6, from_time: "09:00:00", to_time: "13:00:00", price: 1 }],
      60,
    )).toEqual({ weekday: 6, from_time: "09:00", to_time: "13:00" });
  });
});
