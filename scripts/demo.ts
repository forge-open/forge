#!/usr/bin/env node
/**
 * `npm run demo` — end-to-end smoke of the whole pipeline with zero setup:
 * synthetic swarm run → storage → analysis → terminal + markdown + html report
 * written under .forge/runs/<run-id>/.
 */
import { createDemoRun } from '../src/demo.js';
import { generateReport } from '../src/pipeline.js';

const created = await createDemoRun();
console.log(`run ${created.meta.runId} created (synthetic demo swarm)`);

const gen = await generateReport(created.meta.runId, { writeFiles: true });
if (!gen) throw new Error('demo run vanished immediately after creation');

console.log('');
console.log(gen.terminal);
console.log('');
if (gen.markdownPath) console.log(`markdown: ${gen.markdownPath}`);
if (gen.htmlPath) console.log(`html:     ${gen.htmlPath}`);
