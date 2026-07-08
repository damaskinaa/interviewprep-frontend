import { NextResponse } from "next/server";
import { callBackend } from "@/lib/backend";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("job_id") || "";

    if (!jobId) {
      return NextResponse.json({ error: "job_id is required" }, { status: 400 });
    }

    const response = await callBackend(`/prepare/status/${encodeURIComponent(jobId)}`);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Backend returned an error", status: response.status, body: response.text.slice(0, 2000) },
        { status: response.status }
      );
    }

    return NextResponse.json(JSON.parse(response.text));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Prepare status route crashed", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
