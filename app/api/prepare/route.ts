import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const backendUrl = process.env.BACKEND_URL;
  const appApiKey = process.env.APP_API_KEY;

  if (!backendUrl || !appApiKey) {
    return NextResponse.json(
      { error: "Server is not configured" },
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

  const data = await response.json();

  return NextResponse.json(data, { status: response.status });
}
