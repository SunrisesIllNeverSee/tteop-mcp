#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

const packageJson = readJson("../package.json");
const packageLock = readJson("../package-lock.json");
const serverJson = readJson("../server.json");

assert.equal(packageJson.version, "0.2.1", "package version must be the approved release version");
assert.equal(packageLock.version, packageJson.version, "lockfile version must match package version");
assert.equal(packageLock.packages[""].version, packageJson.version, "lockfile root package version must match");
assert.equal(serverJson.version, packageJson.version, "MCP Registry server version must match package version");
assert.equal(serverJson.packages[0].version, packageJson.version, "MCP Registry npm version must match package version");
assert.equal(packageJson.dependencies["tteop-spec"], "0.1.5-draft", "tteop-spec must be pinned exactly");
assert.equal(packageLock.packages[""].dependencies["tteop-spec"], "0.1.5-draft", "lockfile must preserve exact tteop-spec pin");
assert.equal(packageJson.mcpName, serverJson.name, "package mcpName must match MCP Registry name");

console.log("Release metadata is internally consistent for tteop-mcp@0.2.1.");
