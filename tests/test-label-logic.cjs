// Node tests for popup state transitions. DOM/Chrome APIs are test doubles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../extension');
class Element {
  constructor() { this.listeners = {}; this.options = []; this.value = ''; this.style = {}; this.attributes = {}; this.classList = {toggle() {}}; }
  append(...nodes) { this.options.push(...nodes); }
  setAttribute(key,value) { this.attributes[key]=value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  replaceChildren(...options) { this.options = options; }
  add(option) { this.options.push(option); }
  querySelector() { return this.options[0] ||= {}; }
  focus() {}
}
const elements = Object.fromEntries([...fs.readFileSync(path.join(root, 'popup.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
let stored, storageListener, failWrite = false;
let url = 'https://synthetic.test/tasks/1/jobs/1';
let enabled = false;
let catalog = {state: 'ready', labels: [{name:'alpha', duplicate:false}, {name:'unused', duplicate:false}]};
const status = () => ({supported:true, enabled, jobPath:new URL(url).pathname, catalog});
const document = {getElementById:id => elements[id], querySelectorAll:()=>[], createElement:()=>new Element(), addEventListener() {}, activeElement:null};
const context = vm.createContext({document, URL, setTimeout, clearTimeout, navigator:{platform:'Win32'}, window:{addEventListener() {}},
  Option: class {constructor(text, value) {this.textContent=text; this.value=value;}},
  chrome:{storage:{local:{async get(key) {return {[key]:stored};}, async set(data) {
    if (failWrite) throw new Error('Synthetic storage failure');
    const [key,value] = Object.entries(data)[0]; stored=value; storageListener({[key]:{newValue:value}},'local');
  }},onChanged:{addListener(fn){storageListener=fn;}}},
  tabs:{async query(){return [{id:1,url}];},async sendMessage(id,msg){if(msg.type==='CVAT_SHORTCUTS_DISABLE') enabled=false;return status();}},
  scripting:{async executeScript(){enabled=true;return [{frameId:0,result:status()}];}}}});
vm.runInContext(fs.readFileSync(path.join(root,'common.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'popup.js'),'utf8'),context);
const tick = () => new Promise(r=>setImmediate(r));
const fire = async (id,type='click') => {elements[id].listeners[type]();await tick();};
const choices = () => elements['label-color-list'].options.map(row => row.options[0]);
const chosen = () => choices().find(button => button.attributes['aria-pressed'] === 'true');
const choose = async (name) => { choices().find(button => button.value === name).listeners.click(); await tick(); };
const results = [];
async function test(name, fn) {await fn();results.push({name,passed:true});}
(async()=>{
 await tick();
 await test('List is unavailable before enabling the tab',()=>assert.equal(elements['label-colors'].hidden,true));
 await fire('enable');
 await test('Enable loads every available class including unused',()=>assert.deepEqual(choices().map(o=>o.value),['alpha','unused']));
 await test('Missing saved name does not silently select a class',()=>assert.equal(chosen(),undefined));
 await choose('unused');
 await test('Selection saves its name without caching catalog or job',()=>{
   assert.equal(stored.defaultLabelName,'unused');assert.equal(stored.catalog,undefined);assert.equal(stored.jobPath,undefined);
 });
 const before=JSON.stringify(stored);
 catalog={state:'ready',labels:[{name:'alpha',duplicate:false},{name:'same',duplicate:true}]};await fire('label-refresh');
 await test('Refresh clears missing selection, disables duplicates and preserves settings',()=>{
   assert.equal(chosen(),undefined);assert.equal(choices()[1].disabled,true);assert.equal(JSON.stringify(stored),before);
 });
 catalog={state:'ready',labels:[]};await choose('alpha');
 await test('Removed class is rejected before saving',()=>assert.equal(JSON.stringify(stored),before));
 catalog={state:'ready',labels:[{name:'alpha',duplicate:false}]};await fire('label-refresh');
 failWrite=true;await choose('alpha');failWrite=false;
 await test('Storage failure retains the old preference',()=>assert.equal(JSON.stringify(stored),before));
 await fire('enable');url='https://synthetic.test/tasks/2/jobs/2';await choose('alpha');
 await test('Changed job rejects stale selection and clears catalog',()=>{
   assert.equal(JSON.stringify(stored),before);assert.equal(elements['label-colors'].hidden,true);
 });
 document.activeElement=elements['default-label'];elements['default-label'].value='pasted label';
 storageListener({[context.CVATShortcuts.STORAGE_KEY]:{newValue:stored}},'local');
 await test('Unrelated settings updates preserve focused manual input',()=>assert.equal(elements['default-label'].value,'pasted label'));
 const reader=context.CVATShortcuts.readLabelCatalog;
 const row=(name)=>({querySelectorAll:()=>[{textContent:name}]});
 const list={querySelectorAll:()=>[row('alpha'),row('unused')],querySelector:()=>({textContent:'Items: 2'})};
 const dom={querySelectorAll:selector=>selector==='.cvat-objects-sidebar-labels-list'?[list]:[]};
 await test('Catalog reads complete class list',()=>assert.equal(JSON.stringify(reader(dom)),JSON.stringify({state:'ready',labels:[{name:'alpha',duplicate:false},{name:'unused',duplicate:false}]})));
 list.querySelector=()=>({textContent:'Items: 3'});
 await test('Incomplete sidebar list fails closed',()=>assert.equal(reader(dom).state,'unavailable'));
 const overviewRow=(key,name)=>({getAttribute:()=>key,querySelector:()=>({textContent:name})});
 const overview={querySelectorAll:()=>[overviewRow('a','alpha'),overviewRow('b','alpha'),overviewRow('Total','Total'),overviewRow('___total','Total')]};
 const overviewDom={querySelectorAll:selector=>selector==='.cvat-job-info-statistics'?[overview]:[]};
 await test('Overview excludes sentinel total and flags duplicate names',()=>assert.equal(JSON.stringify(reader(overviewDom)),JSON.stringify({state:'ready',labels:[{name:'alpha',duplicate:true},{name:'Total',duplicate:false}]})));
 const report={suite:'label logic',environment:'Node VM with DOM and Chrome API test doubles; not browser integration',passed:results.length,failed:0,results};
 fs.writeFileSync(path.join(__dirname,'label-logic-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`${results.length} label logic tests passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
