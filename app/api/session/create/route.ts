import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type DaytonaPreviewResponse = { url?: string; token?: string; data?: { url?: string; token?: string } };

function getValue(response: DaytonaPreviewResponse, key: "url" | "token") {
  return response[key] || response.data?.[key] || "";
}

function buildDaytonaUrl(previewUrl: string, endpoint: string) {
  const url = new URL(previewUrl.trim());
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${endpoint}`;
  return url.toString();
}

async function getDaytonaPreview() {
  const apiKey = process.env.DAYTONA_API_KEY;
  const sandboxId = process.env.DAYTONA_SANDBOX_ID;
  const port = process.env.DAYTONA_PORT || "8000";
  if (!apiKey || !sandboxId || !port) throw new Error("Daytona environment variables are missing.");
  const response = await fetch(`https://app.daytona.io/api/sandbox/${sandboxId}/ports/${port}/preview-url`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Daytona preview lookup failed: ${response.status} ${text.slice(0, 500)}`);
  const data = JSON.parse(text) as DaytonaPreviewResponse;
  const previewUrl = getValue(data, "url");
  const previewToken = getValue(data, "token");
  if (!previewUrl || !previewToken) throw new Error("Daytona preview response did not include url and token.");
  return { previewUrl, previewToken };
}

export async function POST(request: Request) {
  try {
    const appApiKey = process.env.APP_API_KEY;
    if (!appApiKey) return NextResponse.json({ error: "Server is not configured" }, { status: 500 });
    const body = await request.json();
    const { previewUrl, previewToken } = await getDaytonaPreview();
    const response = await fetch(buildDaytonaUrl(previewUrl, "/session/create"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Key": appApiKey,
        "x-daytona-preview-token": previewToken,
        "X-Daytona-Skip-Preview-Warning": "true",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json({ error: "Backend returned an error", status: response.status, body: text.slice(0, 2000) }, { status: response.status });
    }
    return NextResponse.json(JSON.parse(text));
  } catch (err: unknown) {
    return NextResponse.json({ error: "Session create route crashed", message: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
