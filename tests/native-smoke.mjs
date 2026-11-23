import { mkdtemp, cp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { compilePlugin } from "../node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js";

// Require an explicit runtime: never silently substitute Node for Hermes.
// Use the Hermes of the React Native release the Paseo app ships.
const { version: reactNative } = JSON.parse(
  await readFile(new URL("../node_modules/react-native/package.json", import.meta.url), "utf8"),
);
const hermes = process.argv[2];
if (!hermes) throw new Error(`Usage: npm run test:native -- /absolute/path/to/hermes (React Native ${reactNative})`);
const version = spawnSync(hermes, ["-version"], { encoding: "utf8" });
if (version.error) throw version.error;
if (version.status !== 0 || !version.stdout.includes(`for RN ${reactNative}`))
  throw new Error(`Use the Hermes executable distributed with React Native ${reactNative}`);

const root = process.cwd();
await mkdir(path.join(root, ".test-output"), { recursive: true });
const dir = await mkdtemp(path.join(root, ".test-output/canvas-native-"));
try {
  const production = await compilePlugin({ client: path.join(root, "index.client.tsx"), server: null });
  // Exercise shared code through the SAME released compiler and eval boundary.
  await mkdir(path.join(dir, "client"));
  await cp(path.join(root, "client/selection.ts"), path.join(dir, "client/selection.ts"));
  await cp(path.join(root, "client/editing-state.ts"), path.join(dir, "client/editing-state.ts"));
  await cp(path.join(root, "shared"), path.join(dir, "shared"), { recursive: true });
  await writeFile(path.join(dir, "index.client.ts"), `
import { createCanvasSelection } from "./client/selection";
import { createCanvasEditor } from "./client/editing-state";
function assert(ok, message) { if (!ok) throw new Error(message); }
export default function () {
  const editor = createCanvasEditor("workspace", {});
  editor.newCanvas(); editor.change({title:"Title",content:"Draft"});
  assert(editor.getSnapshot().draft.content === "Draft", "user draft");
  editor.navigate(function(){throw new Error("Unconfirmed navigation");});
  assert(editor.getSnapshot().confirmation === "discard", "discard confirmation");
  editor.dismissConfirmation(); editor.dispose();
  const selection = createCanvasSelection();
  let calls = 0;
  const stop = selection.subscribe("workspace", () => calls++);
  selection.select("workspace", "canvas");
  assert(selection.get("workspace") === "canvas" && calls === 1, "selection update");
  assert(selection.get("other") === null, "workspace isolation");
  assert(createCanvasSelection().get("workspace") === null, "installation isolation");
  stop(); selection.select("workspace", null);
  assert(calls === 1 && selection.get("workspace") === null, "unsubscribe and clear");
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
  "@getpaseo/plugin": {
    defineRpc: function(value){return value;}, defineSubscription: function(value){return value;},
    defineSettings: function(value){return value;}, defineAttachmentSource: function(value){return value;},
    PluginAttachmentSearchPayloadSchema: schema
  },
  "@getpaseo/plugin/client": {
    defineTranslations: function(definition){
      assert(definition.resources.en && definition.resources.ja, "translations");
      return {resources: definition.resources, message: function(key){return {key: key};}};
    }
  },
  "@getpaseo/plugin/client/ui": {},
  "@tanstack/react-query": {}, "zod": {z:schema}
};
function require(name) { assert(name in modules, "Unexpected host import: " + name); return modules[name]; }
var panels=[], renderers=[], commands=[], screens=[], sidebar=[], settings=[], slash=[], attachments=[], opened=[];
function register(list) {return function(item){list.push(item);return function(){list.splice(list.indexOf(item),1);};};}
var cleanup=(0,eval)(${JSON.stringify(production.clientBundle)})(require).default({
  addWorkspacePanel:register(panels), addTimelineRenderer:register(renderers), addCommandCenterItem:register(commands),
  addScreen:register(screens), addSidebarHeaderItem:register(sidebar), addSettingsScreen:register(settings),
  addSlashCommand:register(slash), addAttachmentSource:register(attachments),
  openPanel:function(id,options){opened.push({id:id,workspaceId:options.workspaceId});}
});
Promise.resolve().then(function(){
assert(panels.length===1 && renderers.length===1 && commands.length===2 && screens.length===1 &&
  sidebar.length===1 && settings.length===1 && slash.length===1 && attachments.length===1,"plugin registration");
assert(panels[0].title.key==="plugin.title" && slash[0].name==="canvas","translated registration");
var selection=panels[0].Component({}).props.selection;
selection.select("workspace","canvas");
assert(selection.get("workspace")==="canvas","production selection");
cleanup();
assert(panels.length===0 && renderers.length===0 && commands.length===0 && slash.length===0 && attachments.length===0,"plugin cleanup");
(0,eval)(${JSON.stringify(probe.clientBundle)})(require).default()();
print("Hermes native smoke passed: startup, registrations, selection, user drafts and discard confirmation, cleanup");
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
