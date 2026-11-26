/**
 * Evento de calendario (.ics, RFC 5545) para "Agregar al calendario" en Mi turno.
 * Las horas van en UTC (sufijo Z): el calendario las muestra en la hora del teléfono.
 */

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location: string;
  description: string;
  url: string;
};

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Escapa texto según RFC 5545 (barra, punto y coma, coma y saltos de línea). */
export function escapeIcsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Corta líneas de más de 75 octetos (continuación con un espacio). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > 75) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function buildIcs(e: IcsEvent, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Depoturnos//Mi turno//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(e.start)}`,
    `DTEND:${utc(e.end)}`,
    `SUMMARY:${escapeIcsText(e.summary)}`,
    `LOCATION:${escapeIcsText(e.location)}`,
    `DESCRIPTION:${escapeIcsText(e.description)}`,
    `URL:${e.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
