import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Facts one override learns about the current request that another override has to act on.
 *
 * The OpenNext image adapter turns every error of the image loader into a 500, so a missing source
 * image cannot be reported as 404 from the loader. The loader records it here and the wrapper
 * (which sets the status) reads it.
 */
export type RequestContext = { sourceImageMissing: boolean };

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function markSourceImageMissing() {
  const ctx = requestContext.getStore();
  if (ctx) ctx.sourceImageMissing = true;
}
