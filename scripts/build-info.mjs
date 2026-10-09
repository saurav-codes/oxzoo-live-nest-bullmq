// npm runs this after `nest build`: the build time that /_zoo/health reports.
import { writeFileSync } from 'node:fs';

const builtAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
writeFileSync(new URL('../dist/build-info.json', import.meta.url), JSON.stringify({ built_at: builtAt }) + '\n');
console.log(`build-info: built_at ${builtAt}`);
