import { vi } from "vitest";
import { CONNECTION_STRING } from "./azurite.js";

/** Points the overrides at the test Azurite and gives every test file its own resources. */
export function useAzurite(
  names: { container?: string; assets?: string; table?: string; queue?: string } = {},
) {
  vi.stubEnv("AZURE_STORAGE_CONNECTION_STRING", CONNECTION_STRING);
  vi.stubEnv("AZURE_STORAGE_ACCOUNT_NAME", "");
  vi.stubEnv("OPEN_NEXT_BUILD_ID", "it-build");
  if (names.container) vi.stubEnv("CACHE_CONTAINER_NAME", names.container);
  if (names.assets) vi.stubEnv("ASSETS_CONTAINER_NAME", names.assets);
  if (names.table) vi.stubEnv("CACHE_TABLE_NAME", names.table);
  if (names.queue) vi.stubEnv("REVALIDATION_QUEUE_NAME", names.queue);
}
