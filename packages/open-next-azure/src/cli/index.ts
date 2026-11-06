#!/usr/bin/env node
import { deploy } from "./deploy.js";
import { packageApp } from "./package-app.js";

/**
 * opennext-azure package   Turn `.open-next` into one deployable Function app (.open-next-azure/app.zip)
 * opennext-azure deploy    Provision infrastructure, upload assets and cache, deploy the app
 *
 * Run `npx open-next build` first (it produces `.open-next`).
 */
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "package") packageApp();
  else if (cmd === "deploy") deploy(rest);
  else {
    console.log("usage: opennext-azure <package|deploy>");
    process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
