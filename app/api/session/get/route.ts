import { NextResponse } from "next/server";
import { callBackend } from "@/lib/backend";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id") || "";

    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const response = await callBackend(`/session/get?session_id=${encodeURIComponent(sessionId)}`);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Backend returned an error", status: response.status, body: response.text.slice(0, 2000) },
        { status: response.status }
      );
    }

    return NextResponse.json(JSON.parse(response.text));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Session get route crashed", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
