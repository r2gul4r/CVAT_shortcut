/* Isolated Chrome DOM tests. Never connects to a running browser or user profile. */
import {createServer} from "node:http";
import {readFile, mkdir, writeFile, mkdtemp} from "node:fs/promises";
import {spawn, execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.env.CVAT_TEST_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const manifest = JSON.parse(await readFile(path.join(root, "extension", "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting", "storage"]);
assert.deepEqual(manifest.optional_permissions, ['webRequest']);
assert.deepEqual(manifest.background, {service_worker:'health-worker.js'});
assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
for (const forbidden of ["host_permissions", "content_scripts", "externally_connectable", "web_accessible_resources"]) assert.equal(manifest[forbidden], undefined, forbidden);
for (const name of ["common.js", "overlay.js", "content.js", "native-repeat.js", "popup.js", "health-core.js", "health-worker.js", "health-popup.js", "health-page.js", "paste-repeat.js", "review-core.js", "review-native.js", "review-popup.js"]) {
  const source = await readFile(path.join(root, "extension", name), "utf8");
  assert(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|captureVisibleTab|getImageData|toDataURL)\s*\(/.test(source), `${name}: forbidden network/image API`);
  execFileSync(process.execPath, ["--check", path.join(root, "extension", name)], {windowsHide: true});
}

const files = new Map();
for(const name of ['review-core.js','review-api.js','review-native.js','review-popup.js'])files.set('/extension/'+name,path.join(root,'extension',name));
for (const name of ["common.js", "overlay.js", "content.js", "native-repeat.js", "popup.js", "popup.css", "health-popup.js", "health-core.js", "paste-repeat.js"]) files.set("/extension/" + name, path.join(root, "extension", name));
files.set('/tests/test-health-popup.js',path.join(root,'tests/test-health-popup.js'));
for (const name of ["chrome-shim.js", "label-fixture.js", "mac-platform.js", "test-content.js", "test-popup.js", "test-popup-mac.js", "test-wheel.js", "test-conflicts.js", "test-space-pan.js", "test-label-shortcuts.js", "test-overlay.js", "test-native-repeat.js", "test-polygon.js", "test-paste.js"]) files.set("/tests/" + name, path.join(root, "tests", name));
files.set("/tests/mousetrap-1.6.5.js", path.join(root, "reference", "mousetrap-1.6.5.js"));
files.set("/tests/polygon-fixture.js", path.join(root, "tests", "polygon-fixture.js"));
files.set("/tests/popup-demo.js", path.join(root, "tests", "popup-demo.js"));
for (const name of ["guide.html", "guide.css", "updates.html", "updates.css"]) files.set("/tests/" + name, path.join(root, "extension", name));
for (const name of ["01-enable", "02-label", "03-ai-key", "04-brush-key", "05-wheel", "06-space-pan", "07-label-keys", "08-overlay-demo"]) {
  files.set(`/tests/guide-images/${name}.jpg`, path.join(root, "extension", "guide-images", name + ".jpg"));
}
const fixture = await readFile(path.join(root, "tests", "fixture.html"), "utf8");
const popup = await readFile(path.join(root, "extension", "popup.html"), "utf8");
const popupFixture = (run, unrelated = false, mac = false) => popup
  .replace(/src="(review-[\w-]+\.js)"/g,'src="/extension/$1"')
  .replace('src="health-popup.js"', 'src="/extension/health-popup.js"')
  .replace('<link rel="stylesheet" href="popup.css">', '<link rel="stylesheet" href="/extension/popup.css">')
  .replace('<script src="common.js" defer></script>', `<script src="/tests/chrome-shim.js"></script>${mac ? '<script src="/tests/mac-platform.js"></script>' : ""}${unrelated ? '<script>window.testTabURL="https://example.test/unrelated";</script>' : ""}<script src="/extension/common.js" defer></script>`)
  .replace('<script src="popup.js" defer></script>', '<script src="/extension/popup.js" defer></script>' + (run ? `<script src="/tests/${mac ? "test-popup-mac" : "test-popup"}.js" defer></script>` : ""));
const server = createServer(async (request, response) => {
  try {
    const route = new URL(request.url, "http://127.0.0.1").pathname;
    let text;
    if (route === '/tasks/1/jobs/15' || route === '/tests/health-demo') text = popupFixture(false).replace('</body>', route.includes('/jobs/')?'<script src="/tests/test-health-popup.js" defer></script></body>':'<script>window.addEventListener("load",()=>document.getElementById("screen-health").click());</script></body>');
    else if (route === "/tasks/1/jobs/16") text = fixture.replace("/tests/test-content.js", "/tests/test-paste.js").replace('<script src="/extension/common.js"></script>', '<script src="/tests/mousetrap-1.6.5.js"></script><script src="/extension/common.js"></script>');
    else if (route === "/tasks/1/jobs/1") text = fixture;
    else if (route === "/tasks/1/jobs/11") text = fixture.replace("/tests/test-content.js", "/tests/test-polygon.js")
      .replace('<script src="/tests/label-fixture.js"></script>', '<script src="/tests/polygon-fixture.js"></script><script src="/tests/label-fixture.js"></script>');
    else if (route === "/tasks/1/jobs/10") text = fixture.replace("/tests/test-content.js", "/tests/test-native-repeat.js")
      .replace('<script src="/extension/common.js"></script>', '<script src="/tests/mousetrap-1.6.5.js"></script><script src="/extension/common.js"></script>');
    else if (route === "/tasks/1/jobs/9") text = fixture.replace("/tests/test-content.js", "/tests/test-overlay.js");
    else if (route === "/tasks/1/jobs/8") text = fixture.replace("/tests/test-content.js", "/tests/test-label-shortcuts.js")
      .replace('<script src="/extension/common.js"></script>', '<script src="/tests/mousetrap-1.6.5.js"></script><script src="/extension/common.js"></script>');
    else if (route === "/tasks/1/jobs/6") text = fixture.replace("/tests/test-content.js", "/tests/test-space-pan.js");
    else if (route === "/tasks/1/jobs/2") text = fixture.replace("/tests/test-content.js", "/tests/test-wheel.js");
    else if (route === "/tasks/1/jobs/5") text = fixture.replace("/tests/test-content.js", "/tests/test-conflicts.js")
      .replace('<script src="/extension/common.js"></script>', '<script src="/tests/mousetrap-1.6.5.js"></script><script src="/extension/common.js"></script>');
    else if (route === "/tasks/1/jobs/3" || route === "/tasks/1/jobs/4") {
      text = fixture.replace('<script src="/extension/common.js"></script>', '<script src="/tests/mac-platform.js"></script><script src="/extension/common.js"></script>');
      if (route.endsWith("/4")) text = text.replace("/tests/test-content.js", "/tests/test-wheel.js");
    }
    else if (route === "/tests/popup-test") text = popupFixture(true);
    else if (route === "/tests/popup-mac") text = popupFixture(true, false, true);
    else if (route === "/tests/popup-mac-view") text = popupFixture(false, false, true);
    else if (route === "/tests/popup-view") text = popupFixture(false);
    else if (route === "/tests/popup-demo") text = popupFixture(false).replace('<script src="/tests/chrome-shim.js"></script>', '<script src="/tests/chrome-shim.js"></script><script src="/tests/popup-demo.js"></script>');
    else if (route === "/tests/popup-unrelated") text = popupFixture(false, true);
    else if (files.has(route)) text = await readFile(files.get(route), route.endsWith(".jpg") ? undefined : "utf8");
    else {response.writeHead(404); response.end("Fixture route not found"); return;}
    response.writeHead(200, {"Content-Type": route.endsWith(".jpg") ? "image/jpeg" : route.endsWith(".js") ? "text/javascript" : route.endsWith(".css") ? "text/css" : "text/html", "Cache-Control": "no-store"});
    response.end(text);
  } catch {response.writeHead(500); response.end("Synthetic fixture error");}
});
await new Promise((resolve, reject) => {server.once("error", reject); server.listen(0, "127.0.0.1", resolve);});
const port = server.address().port;
if (process.argv.includes("--serve")) {
  console.log(`Synthetic test server: http://127.0.0.1:${port}`);
  await new Promise(() => {});
}
await mkdir(path.join(root, "tests", ".browser-profiles"), {recursive: true});
const summaries = [];
try {
  const routes = ["/tasks/1/jobs/1", "/tests/popup-test", "/tasks/1/jobs/2", "/tests/popup-mac", "/tasks/1/jobs/3", "/tasks/1/jobs/4", "/tasks/1/jobs/5", "/tasks/1/jobs/6", "/tasks/1/jobs/8", "/tasks/1/jobs/9", "/tasks/1/jobs/10", "/tasks/1/jobs/15", "/tasks/1/jobs/16", "/tasks/1/jobs/11"];
  for (const route of process.argv.includes("--paste-only") ? ["/tasks/1/jobs/16"] : process.argv.includes("--health-only") ? ["/tasks/1/jobs/15"] : process.argv.includes("--native-only") ? ["/tasks/1/jobs/10"] : process.argv.includes("--popup-only") ? ["/tests/popup-test"] : process.argv.includes("--polygon-only") ? routes.slice(-1) : routes) {
    const profile = await mkdtemp(path.join(root, "tests", ".browser-profiles", "isolated-"));
    const args = ["--headless=new", "--disable-gpu", "--disable-gpu-compositing", "--disable-software-rasterizer",
      "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-default-apps",
      "--metrics-recording-only", "--disable-domain-reliability", "--password-store=basic",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--window-size=1200,900",
      `--user-data-dir=${profile}`, "--dump-dom", "--virtual-time-budget=45000", `http://127.0.0.1:${port}${route}`];
    const output = await new Promise((resolve, reject) => {
      const child = spawn(chromePath, args, {windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
      let stdout = ""; let stderr = "";
      const timer = setTimeout(() => {child.kill(); reject(new Error("Isolated Chrome test exceeded 50 seconds"));}, 50000);
      child.stdout.on("data", (data) => {stdout += data;}); child.stderr.on("data", (data) => {stderr += data;});
      child.once("error", (error) => {clearTimeout(timer); reject(error);});
      child.once("close", (code) => {clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`Isolated Chrome failed (${code}): ${stderr.slice(-1800)}`));});
    });
    const match = output.match(/<pre id="test-results">([\s\S]*?)<\/pre>/);
    if (!match) {
      await writeFile(path.join(profile, "missing-report.html"), output);
      throw new Error(`Chrome did not return the synthetic test report: ${path.join(profile, "missing-report.html")}`);
    }
    const decoded = match[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const summary = JSON.parse(decoded);
    summary.platformValidation = route === "/tests/popup-mac" || /\/[34]$/.test(route) ? "macOS metadata/input simulation in Windows Chrome; no Mac hardware" : "Windows Chrome synthetic DOM";
    summaries.push(summary);
    console.log(`${summary.suite} (${summary.platformValidation}): ${summary.passed} passed, ${summary.failed} failed`);
    for (const result of summary.results.filter((test) => !test.passed)) console.log(`FAIL ${result.name}: ${result.error}`);
  }
} finally {await new Promise((resolve) => server.close(resolve));}
const report = {testedAt: new Date().toISOString(), browser: chromePath, environment: "Separate headless Chrome profiles; synthetic DOM only; Chrome extension APIs mocked; no desktop capture or company data", staticChecks: "passed", passed: summaries.reduce((count, suite) => count + suite.passed, 0), failed: summaries.reduce((count, suite) => count + suite.failed, 0), suites: summaries};
const reportName=process.argv.includes('--paste-only')?'paste-results.json':process.argv.includes('--health-only')?'health-popup-results.json':'test-results.json';
await writeFile(path.join(root, "tests", reportName), JSON.stringify(report, null, 2) + "\n");
console.log(`Report: ${path.join(root, "tests", reportName)}`);
if (report.failed) process.exitCode = 1;
