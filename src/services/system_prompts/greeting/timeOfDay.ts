import { getCurrentCstHour } from "./timezoneUtils";

// 📍 Coordinates for Austin, TX (Capitol area)
const AUSTIN_LAT = 30.2672;
const AUSTIN_LON = -97.7431;

export type TimeOfDayCategory = "early" | "normal" | "late" | "evening";

interface CurrentContext {
  timeStr: string;
  weatherStr: string;
  timeCategory: TimeOfDayCategory;
  guidance: string;
}

/**
 * 🌤️ Fetch Real-Time Weather (No API Key required - uses Open-Meteo)
 * Returns a simple string like "Cloudy, 55°F" or "Unknown" if it fails.
 */
async function getRealTimeWeather(): Promise<string> {
  try {
    // Open-Meteo API requires no key for basic usage
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${AUSTIN_LAT}&longitude=${AUSTIN_LON}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.current) return "Unknown";

    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const condition = decodeWeatherCode(code);

    return `${condition}, ${temp}°F`;
  } catch (error) {
    console.error("Weather fetch failed:", error);
    return "Unknown (assume mild)";
  }
}

/**
 * Helper: Convert WMO codes to human text
 */
function decodeWeatherCode(code: number): string {
  if (code === 0) return "Clear skies";
  if (code === 1 || code === 2 || code === 3) return "Partly cloudy";
  if (code >= 45 && code <= 48) return "Foggy";
  if (code >= 51 && code <= 67) return "Rainy";
  if (code >= 71 && code <= 77) return "Snowy";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 95) return "Thunderstorms";
  return "Cloudy";
}

/**
 * 🏗️ MAIN BUILDER: Current World Anchor
 * Combines Time, Date, and Weather into one grounding header.
 */
export async function buildCurrentWorldContext(): Promise<string> {
  // 1. Get Date & Time Strings
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  };
  const dateTimeStr = new Intl.DateTimeFormat("en-US", options).format(now);

  // 2. Fetch Weather (Async)
  const weatherStr = await getRealTimeWeather();

  // 3. Get Time of Day Guidance (Logic preserved from your code)
  const hour = getCurrentCstHour();
  let timeGuidance = "";

  if (hour < 8) {
    timeGuidance = `It's early. Gentle concern—wonder if they couldn't sleep.`;
  } else if (hour < 11) {
    timeGuidance = `Normal morning hours. Natural, warm greeting.`;
  } else if (hour < 18) {
    timeGuidance = `It's after 11am (Late Morning/Afternoon). Playfully sarcastic about them starting late.`;
  } else {
    timeGuidance = `It's evening. Warmer, "long day?" energy.`;
  }

  // 4. Construct the Final Output
  return `
====================================================
CURRENT WORLD ANCHOR
====================================================
Current Date/Time: ${dateTimeStr} (CST)
Weather in Rowlett: ${weatherStr}

Guidance:
${timeGuidance}
Use this context to ground your greeting ("Stay warm," "Looks like rain," "Good morning").
`;
}