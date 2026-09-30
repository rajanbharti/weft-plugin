// End-to-end host test: real Codex CLI, isolated plugin install, deterministic
// local Responses fixture and local Weft API. No OpenAI account/model required.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = await mkdtemp(join(tmpdir(), "weft-codex-cli-"));
const home = join(root, "home"), repo = join(root, "repo"), market = join(root, "market");
const events = [];
const contextRequests = [];
const contextAcks = [];
const modelInputs = [];
let requests = 0;
let toolName;
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  const json = value => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
  if (req.url.includes("/responses")) {
    requests++;
    const input = JSON.parse(body);
    modelInputs.push(body);
    const functions = (input.tools ?? []).flatMap(t => t.type === "namespace" ? t.tools : [t]);
    toolName = functions.find(t => t.name === "exec_command")?.name;
    const tool = requests === 1 && toolName;
    const item = tool
      ? { id: "fc_test", type: "function_call", call_id: "call_test", name: toolName, arguments: JSON.stringify({ cmd: "printf weft-hook-smoke", max_output_tokens: 50 }) }
      : { id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Weft lifecycle smoke test complete.", annotations: [] }] };
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send("response.created", { response: { id: `resp_${requests}`, status: "in_progress", output: [] } });
    send("response.output_item.added", { output_index: 0, item: { ...item, ...(tool ? { arguments: "" } : { content: [] }) } });
    if (tool) send("response.function_call_arguments.delta", { item_id: item.id, output_index: 0, delta: item.arguments });
    else send("response.output_text.delta", { item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
    send("response.output_item.done", { output_index: 0, item });
    send("response.completed", { response: { id: `resp_${requests}`, status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    res.end(); return;
  }
  if (req.url === "/v1/context") {
    contextRequests.push(JSON.parse(body));
    return json({receiptId:`ctx_${contextRequests.length}`,revision:contextRequests.length,mode:"snapshot",items:[{id:"mem_shared",kind:"guideline",source:"reviewed",content:contextRequests.at(-1).query ? "WEFT_CENTRAL_CONTEXT_PROMPT" : "WEFT_CENTRAL_CONTEXT_START"}],removedIds:[]});
  }
  if (/^\/v1\/context\/[^/]+\/ack$/.test(req.url)) {contextAcks.push(req.url);return json({ok:true});}
  if (req.url === "/v1/activity/capabilities") return json({ schemaVersions: [1], supportedProviders: ["claude", "codex"], maxBatchEvents: 50, maxPayloadBytes: 64000 });
  if (req.url.endsWith("/link")) return json({ repo: { id: "repo_smoke" } });
  if (req.url === "/v1/activity/events") {
    const batch = JSON.parse(body).events;
    events.push(...batch);
    return json({ schemaVersion: 1, acknowledgements: batch.map((e, index) => ({ index, clientEventId: e.clientEventId, status: "accepted", id: e.clientEventId, sequence: events.length })) });
  }
  if (req.url.startsWith("/v1/entries")) return json({ entries: [] });
  res.statusCode = 404; json({ error: "not_found" });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, CODEX_HOME: home, WEFT_CODEX_DATA_DIR: join(root, "data") };
delete env.OPENAI_API_KEY;
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", b => output += b); child.stderr.on("data", b => output += b);
    const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Codex timeout\n${output}`)); }, 45000);
    child.on("error", e => { clearTimeout(timeout); reject(e); });
    child.on("close", code => { clearTimeout(timeout); code === 0 ? resolve(output) : reject(new Error(`Codex exit ${code}\n${output}`)); });
  });
}
try {
  for (const dir of [home, join(repo, ".codex"), join(market, ".agents/plugins"), join(root, "data")]) await mkdir(dir, { recursive: true });
  await cp(resolve("../weft-codex"), join(market, "plugins/weft-codex"), { recursive: true });
  await writeFile(join(market, ".agents/plugins/marketplace.json"), JSON.stringify({ name: "weft-test", plugins: [{ name: "weft-codex", source: { source: "local", path: "./plugins/weft-codex" }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" }] }));
  await writeFile(join(repo, ".codex/memory-config.json"), JSON.stringify({ project_id: "proj_test", server: url }));
  await writeFile(join(root, "data/tokens.json"), JSON.stringify({ proj_test: "pmt_fixture" }), { mode: 0o600 });
  await writeFile(join(home, "config.toml"), `model = "weft-fixture"\nmodel_provider = "weft_fixture"\n[model_providers.weft_fixture]\nname = "Local deterministic fixture"\nbase_url = "${url}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[features]\ncode_mode = false\n[projects.${JSON.stringify(repo)}]\ntrust_level = "trusted"\n`);
  console.log((await run(["plugin", "marketplace", "add", market, "--json"])).trim());
  console.log((await run(["plugin", "add", "weft-codex@weft-test", "--json"])).trim());
  // Only these test-created hooks are trusted for this invocation. User hook
  // trust and sandbox settings are never edited or bypassed in a real session.
  const output = await run(["exec", "--skip-git-repo-check", "--dangerously-bypass-hook-trust", "--sandbox", "read-only", "--json", "Run the synthetic Weft lifecycle smoke test."]);
  const types = events.map(e => e.eventType);
  assert(types.includes("prompt.submitted"), output);
  assert(types.includes("turn.completed"), output);
  assert(types.includes("session.ended"), output);
  assert(toolName && types.includes("tool.completed"), `No actual tool hook observed. ${output}`);
  assert(events.every(e => e.provider === "codex"));
  assert(contextRequests.length >= 2, "Missing session/task context refresh");
  assert(contextAcks.length >= 2, "Missing context delivery acknowledgement");
  assert(modelInputs[0].includes("WEFT_CENTRAL_CONTEXT_PROMPT"), "Prompt context was not injected before the model request");
  console.log(JSON.stringify({ result: "passed", modelRequests: requests, automaticEvents: types, contextRefreshes: contextRequests.length, contextAcknowledgements: contextAcks.length }));
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
