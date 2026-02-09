#!/usr/bin/env bun

import { run } from "../src/index";

await run(Bun.argv.slice(2));
