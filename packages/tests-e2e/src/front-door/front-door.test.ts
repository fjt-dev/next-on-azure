import { describe, expect, it } from "vitest";
import { request } from "../http.js";
import { FRONT_DOOR_ID } from "../setup-front-door.js";

const routes = ["/", "/test.png", "/_next/image?url=%2Ftest.png&w=64&q=75"];

describe("Front Door id check (stack started with FRONT_DOOR_ID)", () => {
  it.each(routes)("answers 403 on %s without the header", async (route) => {
    const res = await request(route);
    expect(res.status).toBe(403);
    expect(res.text).toBe("Forbidden");
  });

  it.each(routes)("answers 403 on %s with a different id", async (route) => {
    expect(
      (await request(route, { headers: { "X-Azure-FDID": "someone-elses-profile" } })).status,
    ).toBe(403);
  });

  it("answers 403 to a POST without the header, before the route handler runs", async () => {
    expect((await request("/api/revalidate", { method: "POST" })).status).toBe(403);
  });

  it.each(routes)("serves %s with the right id, in any letter case", async (route) => {
    for (const id of [FRONT_DOOR_ID, FRONT_DOOR_ID.toUpperCase()]) {
      const res = await request(route, { headers: { "X-Azure-FDID": id, Accept: "image/webp" } });
      expect(res.status).toBe(200);
    }
  });
});
