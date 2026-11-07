import { describe, expect, it } from "vitest";
import { request, timestampIn } from "../http.js";

/** Posts the form without JavaScript: multipart with the hidden action id field. */
async function actionId(): Promise<string> {
  const page = await request("/actions");
  const id = /name="\$ACTION_ID_([0-9a-f]+)"/.exec(page.text)?.[1];
  if (!id) throw new Error("no Server Action id in the form");
  return id;
}

async function submitRefreshForm(): Promise<number> {
  const page = await request("/actions");
  const name = /name="(\$ACTION_ID_[0-9a-f]+)"/.exec(page.text)?.[1];
  if (!name) throw new Error("no Server Action id in the form");
  const boundary = "----e2e-boundary";
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n\r\n--${boundary}--\r\n`;
  const res = await request("/actions", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return res.status;
}

describe("Server Actions and revalidatePath", () => {
  it("keeps a prerendered page until a Server Action revalidates its path", async () => {
    const a = timestampIn((await request("/actions/data")).text);
    expect(a).toBeDefined();
    expect(timestampIn((await request("/actions/data")).text)).toBe(a);

    expect(await submitRefreshForm()).toBe(200);

    const c = timestampIn((await request("/actions/data")).text);
    expect(c).not.toBe(a);
    expect(timestampIn((await request("/actions/data")).text)).toBe(c);
  });

  it("refuses an unknown action id without a server error", async () => {
    const res = await request("/actions", {
      method: "POST",
      headers: {
        "next-action": "0000000000000000000000000000000000000000",
        "content-type": "text/plain",
      },
      body: "[]",
    });
    expect(res.status).toBeLessThan(500);
  });

  it("runs an action called the way client JavaScript does (Next-Action header, Flight response)", async () => {
    const a = timestampIn((await request("/actions/data")).text);
    const res = await request("/actions", {
      method: "POST",
      headers: {
        "next-action": await actionId(),
        "content-type": "text/plain;charset=UTF-8",
        accept: "text/x-component",
      },
      body: "[]",
    });
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/x-component");
    expect(timestampIn((await request("/actions/data")).text)).not.toBe(a);
  });
});
