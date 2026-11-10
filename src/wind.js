// The wind over Santa Teresa Gallura, and which side of the Capo Testa isthmus it leaves sheltered.
export const VILLA = { lat: 41.22235, lon: 9.18833 };
const NAMES = ['Tramontana', 'Grecale', 'Levante', 'Scirocco', 'Ostro', 'Libeccio', 'Ponente', 'Maestrale'];
const CALM_KN = 6;

// shelter(300, 18) -> { sector: 7, name: 'Maestrale', kn: 18, beach: 'Rena di Levante' }; beach is null when it is calm.
// deg = direction the wind comes FROM. Wind with a westerly component hits Rena di Ponente, so the east-facing beach is the calm one.
export function shelter(deg, kn) {
  const d = ((deg % 360) + 360) % 360;
  const sector = Math.round(d / 45) % 8;
  const beach = kn < CALM_KN ? null : d > 180 ? 'Rena di Levante' : 'Rena di Ponente';
  return { sector, name: NAMES[sector], kn: Math.round(kn), beach };
}

// peak([{ h: '14:00', kn: 9 }, { h: '15:00', kn: 18 }]) -> { h: '15:00', kn: 18 }; the first one wins a tie.
export const peak = (hours) => hours.reduce((a, b) => (b.kn > a.kn ? b : a));

// The reading right now plus the next 24 hours, from Open-Meteo (no key). Hours are the villa's local time.
export async function readWind({ lat, lon } = VILLA) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m&hourly=wind_speed_10m&forecast_hours=24&timezone=Europe%2FRome&wind_speed_unit=kn`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`wind ${res.status}`);
  const { current, hourly } = await res.json();
  const hours = hourly.time.map((t, i) => ({ h: t.slice(11, 16), kn: Math.round(hourly.wind_speed_10m[i]) }));
  return { ...shelter(current.wind_direction_10m, current.wind_speed_10m), deg: current.wind_direction_10m, hours };
}
