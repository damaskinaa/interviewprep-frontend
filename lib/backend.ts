type DaytonaPreviewResponse = {
  url?: string;
  token?: string;
  data?: {
    url?: string;
    token?: string;
  };
};

type BackendRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type BackendResponse = {
  ok: boolean;
  status: number;
  text: string;
  headers: Headers;
};

function getValue(response: DaytonaPreviewResponse, key: "url" | "token") {
  return response[key] || response.data?.[key] || "";
}

function buildBackendUrl(baseUrl: string, endpoint: string) {
  const base = new URL(baseUrl.trim());
  const endpointUrl = new URL(endpoint, "http://internal.local");

  base.pathname = `${base.pathname.replace(/\/+$/, "")}${endpointUrl.pathname}`;
  base.search = endpointUrl.search;

  return base.toString();
}

async function getDaytonaPreview() {
  const apiKey = process.env.DAYTONA_API_KEY;
  const sandboxId = process.env.DAYTONA_SANDBOX_ID;
  const port = process.env.DAYTONA_PORT || "8000";

  if (!apiKey || !sandboxId) {
    throw new Error("Daytona environment variables are missing.");
  }

  const response = await fetch(
    `https://app.daytona.io/api/sandbox/${sandboxId}/ports/${port}/preview-url`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Daytona preview lookup failed: ${response.status} ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text) as DaytonaPreviewResponse;
  const previewUrl = getValue(data, "url");
  const previewToken = getValue(data, "token");

  if (!previewUrl || !previewToken) {
    throw new Error(`Daytona preview response did not include url and token: ${text.slice(0, 500)}`);
  }

  return { previewUrl, previewToken };
}

export async function callBackend(
  endpoint: string,
  init: BackendRequestInit = {}
): Promise<BackendResponse> {
  const appApiKey = process.env.APP_API_KEY;

  if (!appApiKey) {
    throw new Error("APP_API_KEY is not configured on the server.");
  }

  const backendUrl = process.env.BACKEND_URL;
  const daytonaHeaders: Record<string, string> = {};

  let targetUrl: string;

  if (backendUrl) {
    targetUrl = buildBackendUrl(backendUrl, endpoint);
  } else {
    const { previewUrl, previewToken } = await getDaytonaPreview();
    targetUrl = buildBackendUrl(previewUrl, endpoint);
    daytonaHeaders["x-daytona-preview-token"] = previewToken;
    daytonaHeaders["X-Daytona-Skip-Preview-Warning"] = "true";
  }

  const response = await fetch(targetUrl, {
    method: init.method || "GET",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      "X-App-Key": appApiKey,
      ...daytonaHeaders,
      ...(init.headers || {}),
    },
    ...(init.body ? { body: init.body } : {}),
    cache: "no-store",
  });

  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
    headers: response.headers,
  };
}
