// The one HTML page: queue counts, a form, and the newest results.

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface Row {
  job_id: string;
  input: string;
  output: string;
  worker: string;
  queued_at: Date;
  finished_at: Date;
}

export function page(counts: Record<string, number>, rows: Row[], error?: string): string {
  const countCells = Object.entries(counts)
    .map(([k, v]) => `<div class="c"><b>${esc(v)}</b><span>${esc(k)}</span></div>`)
    .join('');
  const body = rows
    .map(
      (r) => `<tr><td>${esc(r.job_id)}</td><td>${esc(r.input)}</td><td><code>${esc(r.output.slice(0, 16))}</code></td>` +
        `<td>${esc(new Date(r.finished_at).getTime() - new Date(r.queued_at).getTime())} ms</td><td>${esc(r.worker)}</td>` +
        `<td>${esc(new Date(r.finished_at).toISOString())}</td></tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>nest-bullmq</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:56rem;padding:0 1rem;color:#333}
.counts{display:flex;gap:1rem;margin:1rem 0}.c{border:1px solid #ddd;border-radius:10px;padding:.5rem 1rem;text-align:center}
.c b{display:block;font-size:1.4rem}.c span{color:#777;font-size:.8rem}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #eee;padding:.3rem;text-align:left;font-size:.9rem}
.err{color:#b00}input{padding:.3rem;width:20rem}
</style></head><body>
<h1>nest-bullmq</h1>
<p>NestJS enqueues a job in BullMQ (Redis). A separate worker process hashes the text 20,000 times and writes the result to Postgres.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<div class="counts">${countCells}</div>
<form method="post" action="/jobs"><input name="text" maxlength="200" required placeholder="text to hash"> <button>Enqueue</button></form>
<h2>Newest results</h2>
<table><thead><tr><th>job</th><th>text</th><th>sha256 x20000</th><th>queue to done</th><th>worker</th><th>finished</th></tr></thead>
<tbody>${body || '<tr><td colspan="6">No jobs yet.</td></tr>'}</tbody></table>
<p><a href="/">Refresh</a> · <a href="/api/queue">JSON</a> · <a href="/_zoo/probe">probe</a></p>
</body></html>`;
}
