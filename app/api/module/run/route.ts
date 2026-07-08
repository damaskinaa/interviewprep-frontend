import { NextResponse } from "next/server";
import { callBackend } from "@/lib/backend";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await callBackend("/module/run", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Backend returned an error", status: response.status, body: response.text.slice(0, 2000) },
        { status: response.status }
      );
    }

    return NextResponse.json(JSON.parse(response.text));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Module run route crashed", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
