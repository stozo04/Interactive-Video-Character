interface XAIImageRequest {
  prompt: string;
  model: string;
  image: {
    url: string;
  };
  response_format: string;
}

interface XAIImageResponse {
  created: number;
  data: Array<{
    b64_json?: string;
    url?: string;
  }>;
}

const BASE_URL = "https://api.x.ai/v1/images/edits";

export async function generateImageEdit(
  apiKey: string, 
  payload: XAIImageRequest
): Promise<XAIImageResponse> {
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    // Check if response is JSON before parsing
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const errorData = await response.json();
      throw new Error(`xAI API Error: ${response.status} - ${JSON.stringify(errorData)}`);
    } else {
      const textError = await response.text(); // Capture "Failed to..." plain text
      throw new Error(`xAI API Error: ${response.status} - ${textError}`);
    }
  }

  return response.json();
}