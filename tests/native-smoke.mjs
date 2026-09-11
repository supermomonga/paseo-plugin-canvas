import { mkdtemp, cp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { compilePlugin } from "../node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js";

// Require an explicit runtime: never silently substitute Node for Hermes.
const hermes = process.argv[2];
if (!hermes) throw new Error("Usage: npm run test:native -- /absolute/path/to/hermes (React Native 0.81.5)");
const version = spawnSync(hermes, ["-version"], { encoding: "utf8" });
if (version.error) throw version.error;
if (version.status !== 0 || !version.stdout.includes("for RN 0.81.5"))
  throw new Error("Use the Hermes executable distributed with React Native 0.81.5");

const root = process.cwd();
const dir = await mkdtemp(path.join(tmpdir(), "canvas-native-"));
try {
  const production = await compilePlugin({ client: path.join(root, "index.client.tsx"), server: null });
  // Exercise shared code through the SAME released compiler and eval boundary.
  await mkdir(path.join(dir, "client"));
  await cp(path.join(root, "client/selection.ts"), path.join(dir, "client/selection.ts"));
  await cp(path.join(root, "shared/mermaid"), path.join(dir, "shared/mermaid"), { recursive: true });
  await writeFile(path.join(dir, "index.client.ts"), `
import { createCanvasSelection } from "./client/selection";
import { diagramModel, isMermaidDiagnosticError } from "./shared/mermaid/model";
function assert(ok, message) { if (!ok) throw new Error(message); }
export default function () {
  const selection = createCanvasSelection();
  let calls = 0;
  const stop = selection.subscribe("workspace", () => calls++);
  selection.select("workspace", "canvas");
  assert(selection.get("workspace") === "canvas" && calls === 1, "selection update");
  assert(selection.get("other") === null, "workspace isolation");
  assert(createCanvasSelection().get("workspace") === null, "installation isolation");
  stop(); selection.select("workspace", null);
  assert(calls === 1 && selection.get("workspace") === null, "unsubscribe and clear");
  assert(diagramModel("flowchart LR\\nA-->B").kind === "flow", "flowchart");
  assert(diagramModel("sequenceDiagram\\nA->>B: hello").kind === "sequence", "sequence");
  for (const source of ["gantt", "sequenceDiagram\\nA->>B: hello\\nloop retry\\nend"]) {
    let failure;
    try { diagramModel(source); } catch (error) { failure = error; }
    assert(isMermaidDiagnosticError(failure), "diagnostic classification");
    assert(failure instanceof Error && failure.message && failure.hint, "diagnostic fields");
    if (source !== "gantt") assert(failure.sourceLines.join("|") === "loop retry|end", "diagnostic lines");
  }
  assert(!isMermaidDiagnosticError(new TypeError("unexpected")), "unexpected error");
  return () => {};
}
`);
  const probe = await compilePlugin({ client: path.join(dir, "index.client.ts"), server: null });
  // Host services are stubs: this verifies JS execution/registration, not native
  // rendering or Zod validation (covered by the normal suite). Unknown imports fail.
  const harness = `
function assert(ok, message) { if (!ok) throw new Error(message); }
function setTimeout() { return 1; }
function clearTimeout() {}
var schema = new Proxy(function(){return schema;}, {get: function(){return schema;}});
function component() {}
var modules = {
  "react": {createContext: function(value){return {Provider: component};}},
  "react/jsx-runtime": {jsx: function(type,props){return {type:type,props:props};}},
  "react-native": {
    StyleSheet: {create: function(value){return value;}}, Platform: {OS:"android"},
    AppState: {currentState:"active", addEventListener:function(){return {remove:function(){}};}}
  },
  "@getpaseo/plugin": {defineRpc: function(value){return value;}},
  "@getpaseo/plugin/client": {},
  "@getpaseo/plugin/client/react-native": {},
  "@getpaseo/plugin/client/ui": {},
  "@tanstack/react-query": {}, "zod": {z:schema}
};
function require(name) { assert(name in modules, "Unexpected host import: " + name); return modules[name]; }
var panels=[], renderers=[], commands=[], headers=[], opened=[];
var directoryUnsubscribed=false;
function register(list) {return function(item){list.push(item);return function(){list.splice(list.indexOf(item),1);};};}
var cleanup=(0,eval)(${JSON.stringify(production.clientBundle)})(require).default({
  addWorkspacePanel:register(panels), addTimelineRenderer:register(renderers), addCommandCenterItem:register(commands),
  addHeaderButton:function(item){headers.push(item);return {remove:function(){headers.splice(headers.indexOf(item),1);}};},
  openPanel:function(id,options){opened.push({id:id,workspaceId:options.workspaceId});},
  paseo:{workspaces:{subscribe:function(){return function(){directoryUnsubscribed=true;};},list:function(){return Promise.resolve({entries:[{id:"native-workspace"}],pageInfo:{hasMore:false}});}}}
});
Promise.resolve().then(function(){
assert(headers.length===1,"native header registration");
headers[0].button.behavior.onPress();
assert(opened[0].id==="canvas" && opened[0].workspaceId==="native-workspace","native header navigation");
assert(panels.length===1 && renderers.length===1 && commands.length===1,"plugin registration");
var selection=panels[0].Component({}).props.selection;
selection.select("workspace","canvas");
assert(selection.get("workspace")==="canvas","production selection");
cleanup();
assert(directoryUnsubscribed && headers.length===0,"native header cleanup");
assert(panels.length===0 && renderers.length===0 && commands.length===0,"plugin cleanup");
(0,eval)(${JSON.stringify(probe.clientBundle)})(require).default()();
print("Hermes native smoke passed: startup, header navigation, selection, Mermaid layouts and diagnostics, cleanup");
}).catch(function(error){print(error.stack);});
`;
  const script = path.join(dir, "smoke.js");
  await writeFile(script, harness);
  const result = spawnSync(hermes, [script], { encoding: "utf8", timeout: 30_000 });
  if (result.error) throw result.error;
  if (result.status !== 0 || !result.stdout.includes("Hermes native smoke passed:"))
    throw new Error(result.stderr || result.stdout);
  process.stdout.write(result.stdout);
} finally {
  await rm(dir, { recursive: true, force: true });
}
