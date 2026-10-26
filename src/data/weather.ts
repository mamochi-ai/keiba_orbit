// Weather forecast from Open-Meteo JMA API (free, non-commercial, CC BY 4.0, no key, CORS).
// Fetched only when the user presses the button. See DATA_SOURCES.md.
import type { Venue } from '../domain/schema';

/** Approximate racecourse coordinates (WGS84). Forecast grid cells are 5–55 km, so ~1 km precision is enough. */
export const VENUE_COORDS: Record<Venue, { lat: number; lon: number }> = {
  札幌: { lat: 43.077, lon: 141.325 },
  函館: { lat: 41.779, lon: 140.781 },
  福島: { lat: 37.765, lon: 140.478 },
  新潟: { lat: 37.948, lon: 139.183 },
  東京: { lat: 35.663, lon: 139.485 },
  中山: { lat: 35.727, lon: 139.958 },
  中京: { lat: 35.067, lon: 137.013 },
  京都: { lat: 34.907, lon: 135.727 },
  阪神: { lat: 34.779, lon: 135.364 },
  小倉: { lat: 33.841, lon: 130.877 },
};

export const WEATHER_PROVIDER = 'Open-Meteo（気象庁 GSM/MSM モデル） CC BY 4.0';

export function weatherUrl(venue: Venue, date: string): string {
  const { lat, lon } = VENUE_COORDS[venue];
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'precipitation,temperature_2m,wind_speed_10m,weather_code',
    timezone: 'Asia/Tokyo',
    wind_speed_unit: 'ms',
    start_date: date,
    end_date: date,
  });
  return `https://api.open-meteo.com/v1/jma?${p.toString()}`;
}

interface Hourly {
  time: string[];
  precipitation?: (number | null)[];
  temperature_2m?: (number | null)[];
  wind_speed_10m?: (number | null)[];
}

const fmt = (v: number | null | undefined, unit: string) => (v === null || v === undefined || Number.isNaN(v) ? '欠損' : `${v}${unit}`);

/** Summarise 9:00–17:00 JST. Missing values stay 「欠損」 — never treated as 0. */
export function summarizeWeather(json: unknown): string {
  const hourly = (json as { hourly?: Hourly })?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) throw new Error('天気データの形式が想定と異なります');
  const lines: string[] = [];
  hourly.time.forEach((t, i) => {
    if (typeof t !== 'string') return;
    const h = Number(t.slice(11, 13));
    if (h < 9 || h > 17) return;
    lines.push(
      `${t.slice(11, 16)} 降水${fmt(hourly.precipitation?.[i], 'mm')} 気温${fmt(hourly.temperature_2m?.[i], '℃')} 風速${fmt(hourly.wind_speed_10m?.[i], 'm/s')}`,
    );
  });
  if (lines.length === 0) throw new Error('対象日の時間別予報がありません（予報期間外の可能性）');
  return `競馬場付近の予報（9〜17時 JST、予報値であり馬場状態ではありません）\n${lines.join('\n')}`;
}

export async function fetchWeather(venue: Venue, date: string, signal?: AbortSignal): Promise<{ url: string; text: string }> {
  const url = weatherUrl(venue, date);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`天気の取得に失敗しました（HTTP ${res.status}）`);
  const json: unknown = await res.json();
  return { url, text: summarizeWeather(json) };
}
