import { NextResponse } from "next/server";

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

    let data;
    try {
      data = text ? JSON.parse(text) : { error: "Backend returned empty response" };
    } catch {
      data = {
        error: "Backend returned non JSON response",
        status: response.status,
        body: text.slice(0, 1000),
      };
    }

    return NextResponse.json(data, { status: response.status });
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
