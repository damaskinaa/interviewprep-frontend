import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const backendUrl = process.env.BACKEND_URL;
    const appApiKey = process.env.APP_API_KEY;

    if (!backendUrl || !appApiKey) {
      return NextResponse.json(
        {
          error: "Server is not configured",
          hasBackendUrl: Boolean(backendUrl),
          hasAppApiKey: Boolean(appApiKey),
        },
        { status: 500 }
      );
    }

    const body = await request.json();

    const response = await fetch(`${backendUrl}/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Key": appApiKey,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Backend returned an error",
          status: response.status,
          body: text.slice(0, 2000),
        },
        { status: response.status }
      );
    }

    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        {
          error: "Backend returned non JSON response",
          status: response.status,
          body: text.slice(0, 2000),
        },
        { status: 502 }
      );
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          error: "Backend JSON could not be parsed",
          body: text.slice(0, 2000),
        },
        { status: 502 }
      );
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Frontend API route crashed",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
