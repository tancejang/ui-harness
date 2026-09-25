#!/usr/bin/env node
import { main } from '../src/cli.mjs';
main().catch(error => { process.stderr.write(`uih: ${error.message}\n`); process.exitCode = 1; });
