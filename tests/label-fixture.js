/* Synthetic Ant Select markup based on public CVAT LabelSelector/rc-select source. */
(() => {
  const fixtures = [];
  for (const id of ["ai-label", "mask-label"]) {
    const original = document.getElementById(id);
    const root = document.createElement("div"); root.id = id; root.className = "ant-select";
    root.style.cssText = "display:inline-block;width:220px;";
    const trigger = document.createElement("div"); trigger.className = "ant-select-selector";
    trigger.style.cssText = "border:1px solid #bbb;padding:4px;position:relative";
    const selection = document.createElement("span"); selection.className = "ant-select-selection-item";
    const label = document.createElement("span"); label.className = "cvat-label-selector-option";
    const text = document.createElement("span"); text.className = "ant-typography";
    label.append(text); selection.append(label);
    const combo = document.createElement("input"); combo.type = "search"; combo.setAttribute("role", "combobox");
    combo.setAttribute("aria-controls", id + "_list"); combo.setAttribute("aria-expanded", "false");
    combo.style.cssText = "position:absolute;width:1px;height:1px;opacity:0";
    trigger.append(selection, combo); root.append(trigger); original.replaceWith(root);
    const dropdown = document.createElement("div"); dropdown.className = "ant-select-dropdown";
    dropdown.style.cssText = "position:fixed;width:230px;background:white;border:1px solid #aaa;z-index:100";
    dropdown.hidden = true;
    const list = document.createElement("div"); list.id = id + "_list"; list.setAttribute("role", "listbox");
    list.style.cssText = "max-height:180px;overflow:auto"; dropdown.append(list); document.body.append(dropdown);
    const config = {openDelay: 0, selectionDelay: 0, ignoreSelection: false, clicks: 0};
    let selectedValue = "obstacle";
    const update = (value, emit = false) => {
      const changed = selectedValue !== value; selectedValue = value; text.textContent = value;
      for (const option of list.children) option.setAttribute("aria-selected", String(option.getAttribute("data-label") === value));
      if (emit && changed) root.dispatchEvent(new Event("change", {bubbles: true}));
    };
    Object.defineProperty(root, "value", {get: () => selectedValue, set: (value) => update(String(value))});
    const options = (names = ["person", "obstacle", "object"]) => {
      list.replaceChildren();
      for (const name of names) {
        const option = document.createElement("div"); option.className = "ant-select-item-option";
        option.setAttribute("role", "option"); option.setAttribute("data-label", name);
        option.style.cssText = "padding:5px 8px;min-height:20px";
        const content = document.createElement("span"); content.className = "cvat-label-selector-option";
        content.textContent = name; option.append(content);
        option.onclick = () => {
          config.clicks += 1; dropdown.hidden = true; combo.setAttribute("aria-expanded", "false");
          if (!config.ignoreSelection) {
            const choose = () => update(name, true);
            config.selectionDelay ? setTimeout(choose, config.selectionDelay) : choose();
          }
        };
        list.append(option);
      }
      update(selectedValue);
    };
    trigger.onmousedown = (event) => {
      event.preventDefault();
      const open = () => {
        const rect = root.getBoundingClientRect(); dropdown.style.left = rect.left + "px"; dropdown.style.top = rect.bottom + "px";
        dropdown.hidden = !dropdown.hidden; combo.setAttribute("aria-expanded", String(!dropdown.hidden));
      };
      config.openDelay ? setTimeout(open, config.openDelay) : open();
    };
    trigger.onclick = () => combo.focus();
    options();
    fixtures.push({root, combo, trigger, list, dropdown, config, options});
  }
  window.labelFixture = {
    byID(id) {return fixtures.find((fixture) => fixture.root.id === id);},
    reset() {
      for (const fixture of fixtures) {
        Object.assign(fixture.config, {openDelay: 0, selectionDelay: 0, ignoreSelection: false, clicks: 0});
        fixture.options(); fixture.root.value = "obstacle"; fixture.dropdown.hidden = true;
        fixture.combo.setAttribute("aria-expanded", "false"); fixture.combo.disabled = false;
        fixture.combo.setAttribute("aria-controls", fixture.root.id + "_list");
        fixture.root.className = "ant-select";
      }
    }
  };
})();
