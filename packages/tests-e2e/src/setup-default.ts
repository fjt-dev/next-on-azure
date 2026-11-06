import type { TestProject } from "vitest/node";
import { type RunningStack, startStack } from "./stack.js";

let stack: RunningStack | undefined;

export async function setup(project: TestProject) {
  stack = await startStack();
  project.provide("baseUrl", stack.baseUrl);
  project.provide("runDir", stack.runDir);
}

export async function teardown() {
  await stack?.stop();
}
