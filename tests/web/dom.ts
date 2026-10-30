// A small DOM fixture for the browser entry point. HTML parsing is deliberately unsupported:
// every render must use textContent and nodes, including untrusted agent names.
export class NodeFixture {
  children: NodeFixture[] = [];
  className = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  appendCalls = 0;
  replaceCalls = 0;
  scrollHeight = 0;
  clientHeight = 0;
  scrollTop = 0;
  value = "";
  disabled = false;
  hidden = false;
  type = "";
  min = "";
  max = "";
  private listeners = new Map<string, Array<() => void>>();
  private text = "";

  constructor(readonly tagName: string, readonly ownerDocument: DocumentFixture) {}

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  set innerHTML(_value: string) { throw new Error("Unsafe HTML rendering"); }
  get classList() {
    return {
      add: (...names: string[]) => { this.className = [...new Set([...this.className.split(" "), ...names])].filter(Boolean).join(" "); },
      remove: (...names: string[]) => { this.className = this.className.split(" ").filter((name) => !names.includes(name)).join(" "); },
    };
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
    if (name === "class") this.className = value;
  }
  removeAttribute(name: string) { delete this.attributes[name]; }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  click() { if (!this.disabled) this.dispatch("click"); }
  querySelector(selector: string) {
    return selector.startsWith(".") ? this.find(selector.slice(1))[0] ?? null : this.tags(selector)[0] ?? null;
  }
  append(...nodes: NodeFixture[]) {
    this.appendCalls += 1;
    for (const node of nodes) {
      if (node.tagName === "#fragment") {
        this.children.push(...node.children);
        node.children = [];
      } else this.children.push(node);
    }
  }
  replaceChildren(...nodes: NodeFixture[]) {
    this.replaceCalls += 1;
    this.text = "";
    this.children = [];
    this.append(...nodes);
  }
  find(className: string): NodeFixture[] {
    return [this, ...this.children.flatMap((child) => child.find(className))]
      .filter((node) => node.className.split(" ").includes(className));
  }
  tags(tagName: string): NodeFixture[] {
    return [this, ...this.children.flatMap((child) => child.tags(tagName))]
      .filter((node) => node.tagName === tagName);
  }
}

export class DocumentFixture {
  nodes = new Map<string, NodeFixture>();
  createElement(tagName: string) { return new NodeFixture(tagName, this); }
  createElementNS(_namespace: string, tagName: string) { return this.createElement(tagName); }
  createDocumentFragment() { return this.createElement("#fragment"); }
  querySelector(selector: string) { return this.nodes.get(selector) ?? null; }
  asDocument() { return this as unknown as Document; }
  mount(selector: string, tagName: string, text = "") {
    const node = this.createElement(tagName);
    node.textContent = text;
    this.nodes.set(selector, node);
    return node;
  }
}
