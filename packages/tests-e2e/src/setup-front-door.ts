import type { TestProject } from "vitest/node";
import { type RunningStack, startStack } from "./stack.js";

export const FRONT_DOOR_ID = "e2e-front-door-id";
let stack: RunningStack | undefined;

export async function setup(project: TestProject) {
  stack = await startStack({ FRONT_DOOR_ID });
  project.provide("baseUrl", stack.baseUrl);
  project.provide("runDir", stack.runDir);
}

export async function teardown() {
  await stack?.stop();
}
