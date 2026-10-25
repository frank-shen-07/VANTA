import { connection } from "next/server";
import { handleGenerate, handleStatus } from "@/server/http/sceneHandlers";

/** GET → SceneApiStatus. `connection()` keeps it request-time (env may differ from build time). */
export async function GET() {
  await connection();
  return handleStatus();
}

/** POST → SceneGenerationResponse | SceneApiError. */
export async function POST(request: Request) {
  return handleGenerate(request);
}
