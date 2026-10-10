'use strict';
// Minimal stand-in for Obsidian's runtime module, so main.js can be required in Node.
const notices = [];
class TFile { constructor(path = '') { this.path = path; this.extension = 'md'; this.basename = path.split('/').pop().replace(/\.[^.]+$/, ''); } }
class TFolder { constructor(path = '') { this.path = path; this.children = []; } }
class Notice { constructor(message) { notices.push(String(message)); } }
class Modal { constructor(app) { this.app = app; this.contentEl = { empty() {}, createEl() { return this; }, createDiv() { return this; } }; this.modalEl = this.contentEl; } open() {} close() {} onOpen() {} onClose() {} }
class FuzzySuggestModal extends Modal { setPlaceholder() {} getItems() { return []; } getItemText() { return ''; } onChooseItem() {} }
class ItemView { constructor(leaf) { this.leaf = leaf; this.containerEl = { children: [{}], empty() {}, createEl() { return this; } }; } getViewType() { return ''; } getDisplayText() { return ''; } async onOpen() {} }
class Component { load() {} unload() {} registerEvent() {} registerInterval() {} addChild() {} }
class Plugin extends Component { constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; } addCommand() {} addSettingTab() {} addRibbonIcon() {} registerView() {} async loadData() { return {}; } async saveData() {} }
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = { empty() {}, createEl() { return this; }, createDiv() { return this; } }; } display() {} hide() {} }
class Setting { constructor() {} setName() { return this; } setDesc() { return this; } setHeading() { return this; } addToggle(cb) { cb({ setValue() { return this; }, onChange() { return this; } }); return this; } addText(cb) { cb({ setValue() { return this; }, onChange() { return this; }, setPlaceholder() { return this; } }); return this; } addButton(cb) { cb({ setButtonText() { return this; }, setCta() { return this; }, onClick() { return this; } }); return this; } addDropdown(cb) { cb({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; } addExtraButton(cb) { cb({ setIcon() { return this; }, onClick() { return this; } }); return this; } }
class FileSystemAdapter {}
class MarkdownRenderer { static async render() {} }
function normalizePath(p) { return String(p ?? '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, ''); }
function parseYaml() { return {}; }
module.exports = { Plugin, Notice, Modal, FuzzySuggestModal, TFile, TFolder, parseYaml, FileSystemAdapter, PluginSettingTab, Setting, ItemView, normalizePath, Component, MarkdownRenderer, __notices: notices };
