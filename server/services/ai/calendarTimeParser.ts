// server/services/ai/calendarTimeParser.ts
//
// Lightweight Gemini-based datetime normalizer for calendar tool calls.
// Converts natural language time expressions into local ISO datetimes
// (YYYY-MM-DDTHH:mm:ss) in a target IANA timezone.

import { ai, GEMINI_MODEL } from './geminiClient';
import { log } from '../../runtimeLogger';

const runtimeLog = log.fromContext({ source: 'calendarTimeParser' });
const LOCAL_ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export interface CalendarWindowParseRequest {
  summary?: string;
  userMessage?: string;
  startRaw: string;
  endRaw?: string;
  timeZone: string;
}

export interface CalendarWindowParseResult {
  start: string;
  end: string;
  confidence: 'high' | 'medium' | 'low';
}

function isLocalIsoDateTime(value: string): boolean {
  return LOCAL_ISO_DATETIME_RE.test(value.trim());
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  for (let i = firstBrace; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(trimmed.slice(firstBrace, i + 1));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export async function parseCalendarWindowWithGemini(
  request: CalendarWindowParseRequest,
): Promise<CalendarWindowParseResult | null> {
  try {
    const nowIso = new Date().toISOString();

    const instruction = [
      'You normalize calendar datetime inputs into local ISO datetime strings.',
      'Output JSON only.',
      'Return exactly these keys: start, end, confidence.',
      'Format for start/end must be YYYY-MM-DDTHH:mm:ss (no timezone suffix).',
      'Interpret all times in the provided timezone.',
      'If only one time is provided, set end to +1 hour.',
      'If only a time is given, choose the next future occurrence.',
      'Resolve relative words like today/tomorrow/tonight/next Monday.',
      'If truly ambiguous, still choose the most reasonable future interpretation and set confidence to low.',
      '',
      `timezone: ${request.timeZone}`,
      `now_utc: ${nowIso}`,
      `summary: ${request.summary ?? ''}`,
      `user_message: ${request.userMessage ?? ''}`,
      `start_input: ${request.startRaw}`,
      `end_input: ${request.endRaw ?? ''}`,
    ].join('\n');

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: instruction }] }],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object' as any,
          properties: {
            start: { type: 'string' as any },
            end: { type: 'string' as any },
            confidence: { type: 'string' as any, enum: ['high', 'medium', 'low'] },
          },
          required: ['start', 'end', 'confidence'],
        },
      },
    });

    const parsed = extractJsonObject(response.text ?? '');
    if (!parsed) {
      runtimeLog.warning('Calendar datetime parser returned non-JSON content', {
        textPreview: (response.text ?? '').slice(0, 240),
      });
      return null;
    }

    const start = String(parsed.start ?? '').trim();
    const end = String(parsed.end ?? '').trim();
    const confidenceRaw = String(parsed.confidence ?? 'low').trim().toLowerCase();
    const confidence =
      confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
        ? (confidenceRaw as 'high' | 'medium' | 'low')
        : 'low';

    if (!isLocalIsoDateTime(start) || !isLocalIsoDateTime(end)) {
      runtimeLog.warning('Calendar datetime parser returned invalid datetime format', {
        start,
        end,
        confidence,
      });
      return null;
    }

    return { start, end, confidence };
  } catch (error) {
    runtimeLog.error('Calendar datetime parser failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

