/* Separate Store release; never writes the development extension or Chrome settings. */
import {readFile, writeFile, mkdir, copyFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "releases", "0.1.1");
const sourceAudit = JSON.parse((await readFile(path.join(root, "store", "package-audit.json"), "utf8")).replace(/^\uFEFF/, ""));
const sourceManifest = await readFile(path.join(root, "extension", "manifest.json"), "utf8");
assert.equal(JSON.parse(sourceManifest).version, "1.4.1");
assert.equal(sourceAudit.version, "1.4.1");
await mkdir(path.dirname(release), {recursive: true});
await mkdir(release); // Refuse to overwrite an existing release folder.
for (const item of sourceAudit.files) {
  const source = path.join(root, "extension", item.name);
  const data = await readFile(source);
  assert.equal(createHash("sha256").update(data).digest("hex"), item.sha256, item.name);
  const target = path.join(release, "extension", item.name);
  await mkdir(path.dirname(target), {recursive: true});
  await copyFile(source, target);
}
const releaseManifest = sourceManifest.replace('"version": "1.4.1"', '"version": "0.1.1"');
assert.equal(JSON.parse(releaseManifest).version, "0.1.1");
await writeFile(path.join(release, "extension", "manifest.json"), releaseManifest);
await mkdir(path.join(release, "tools"));
await copyFile(path.join(root, "tools", "build-artifacts.mjs"), path.join(release, "tools", "build-artifacts.mjs"));
execFileSync(process.execPath, [path.join(release, "tools", "build-artifacts.mjs")], {cwd: release, windowsHide: true, stdio: "inherit"});
for (const name of ["INSTALL-KO.md", "STORE-LISTING-KO.md", "PRIVACY-KO.md", "PILOT-KO.md"]) {
  let text = (await readFile(path.join(root, "store", name), "utf8")).replaceAll("1.4.1", "0.1.1");
  if (name === "INSTALL-KO.md") {
    text = text.replace("이미 설치했다면 기존 `extension` 폴더를 유지하고 확장 카드의 **새로고침**을 누릅니다.",
      "기존 개발판 1.4.1 설치는 그대로 두세요. 이 0.1.1 폴더는 첫 스토어 항목 또는 별도 테스트용이며 기존 개발판 폴더를 덮어쓰지 않습니다. 같은 탭에서 두 확장을 동시에 Enable하지 마세요.");
  }
  if (name === "PILOT-KO.md") {
    text = text.replace("설치/업데이트: 기존 확장 Reload → CVAT 탭 새로고침 → 팝업 Enable. 별도 설치는 설정도 별도입니다.",
      "별도 0.1.1 설치 → CVAT 탭 새로고침 → 해당 확장 팝업 Enable. 기존 개발판 1.4.1은 다운그레이드하지 않고 유지합니다. 별도 설치는 설정도 별도입니다. 같은 탭에서 두 확장을 동시에 Enable하지 마세요.");
  }
  await writeFile(path.join(release, "store", name), text, "utf8");
}
const releaseAuditPath = path.join(release, "store", "package-audit.json");
const audit = JSON.parse(await readFile(releaseAuditPath, "utf8"));
assert.equal(audit.version, "0.1.1");
for (const item of audit.files) {
  if (item.name === "manifest.json") continue;
  assert.equal(item.sha256, sourceAudit.files.find((source) => source.name === item.name).sha256, `Runtime changed: ${item.name}`);
}
assert.equal(await readFile(path.join(root, "extension", "manifest.json"), "utf8"), sourceManifest);
const tests = JSON.parse(await readFile(path.join(root, "tests", "test-results.json"), "utf8"));
assert.equal(tests.passed, 232); assert.equal(tests.failed, 0);
audit.sourceDevelopmentVersion = "1.4.1";
audit.runtimeFilesMatchSource = true;
audit.onlyManifestVersionChanged = true;
audit.developmentManifestUnchanged = true;
audit.sourceTests = {passed: tests.passed, failed: tests.failed, testedAt: tests.testedAt,
  limitation: "Existing 1.4.1 synthetic evidence reused because runtime files are byte-identical. No actual Mac or installed CVAT validation."};
await writeFile(releaseAuditPath, JSON.stringify(audit, null, 2) + "\n");
console.log(`Prepared separate first release: ${release}`);
