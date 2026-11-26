#!/usr/bin/env node
// The `ppgraph` binary: it only starts the CLI. Kept apart from cli.ts, so importing the package never
// has to guess from argv whether it was started — a guess that failed through npm's links.
import { reportFatal, runCli } from './cli.js';

runCli(process.argv.slice(2)).catch((error: unknown) => process.exit(reportFatal(error)));
