import { describe, it, expect } from "vitest";
import { A11yEngine } from "../../src/a11y_engine.js";

describe("A11yEngine & axe-core semantic extractor", () => {
  const engine = new A11yEngine();

  it("parses raw accessibility nodes into clean semantic tree", () => {
    const rawNodes = [
      {
        role: { value: "RootWebArea" },
        name: { value: "Quantum Physics Lab" },
        children: [
          {
            role: { value: "textbox" },
            name: { value: "Prompt Input" },
            value: { value: "A luminous wave passing through two slits" },
            focused: { value: true },
            selector: "#prompt_input"
          },
          {
            role: { value: "button" },
            name: { value: "Generate Scene (Ctrl+Enter)" },
            disabled: { value: false },
            selector: "#btn_generate"
          }
        ]
      }
    ];

    const tree = engine.parseAXNodes(rawNodes);
    expect(tree).toHaveLength(1);
    expect(tree[0].role).toBe("RootWebArea");
    expect(tree[0].name).toBe("Quantum Physics Lab");
    expect(tree[0].children).toHaveLength(2);

    const textbox = tree[0].children![0];
    expect(textbox.role).toBe("textbox");
    expect(textbox.value).toBe("A luminous wave passing through two slits");
    expect(textbox.focused).toBe(true);

    const button = tree[0].children![1];
    expect(button.role).toBe("button");
    expect(button.name).toBe("Generate Scene (Ctrl+Enter)");
  });

  it("formats compact text tree for LLM consumption with token reduction", () => {
    const rawNodes = [
      {
        role: "main",
        name: "Google Flow",
        children: [
          { role: "button", name: "Create Image", selector: "#btn_create" },
          { role: "textbox", name: "Prompt Box", value: "Cosmic ocean", focused: true, selector: "#txt_prompt" }
        ]
      }
    ];

    const snapshot = engine.createSnapshot(
      "https://labs.google/fx/tools/flow",
      "Google Flow",
      rawNodes,
      5000 // simulate 5000 chars raw HTML
    );

    expect(snapshot.url).toBe("https://labs.google/fx/tools/flow");
    expect(snapshot.compactText).toContain("[el_1] <main> \"Google Flow\"");
    expect(snapshot.compactText).toContain("<button> \"Create Image\"");
    expect(snapshot.compactText).toContain("<textbox> \"Prompt Box\" value=\"Cosmic ocean\" (focused)");
    expect(snapshot.tokenSavingsPercent).toBeGreaterThan(80);
  });
});
