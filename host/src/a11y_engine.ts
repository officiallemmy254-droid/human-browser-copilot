// Human Browser Host - Accessibility Tree & Semantic DOM Parser (Powered by axe-core & CDP)
import type { Protocol } from "devtools-protocol";

export interface SemanticA11yNode {
  id: string;
  role: string;
  name: string;
  value?: string;
  description?: string;
  disabled?: boolean;
  focused?: boolean;
  selector: string;
  children?: SemanticA11yNode[];
}

export interface A11yTreeSnapshot {
  url: string;
  title: string;
  totalElements: number;
  tree: SemanticA11yNode[];
  compactText: string;
  tokenSavingsPercent: number;
}

/**
 * Builds a clean, hierarchical semantic tree from CDP AXNodes or DOM Accessibility nodes
 */
export class A11yEngine {
  /**
   * Transforms raw CDP AXNodes or DOM nodes into structured SemanticA11yNodes
   */
  public parseAXNodes(rawNodes: any[]): SemanticA11yNode[] {
    if (!Array.isArray(rawNodes)) return [];

    const nodes: SemanticA11yNode[] = [];
    let counter = 1;

    for (const node of rawNodes) {
      const role = node.role?.value || node.role || "generic";
      const name = node.name?.value || node.name || "";
      const value = node.value?.value || node.value;
      const description = node.description?.value || node.description;
      const disabled = node.disabled?.value || node.disabled || false;
      const focused = node.focused?.value || node.focused || false;

      // Filter out redundant or empty structural containers unless they have children or semantic names
      if (role === "generic" || role === "none" || role === "presentation") {
        if (!name && (!node.children || node.children.length === 0)) {
          continue;
        }
      }

      const parsed: SemanticA11yNode = {
        id: `el_${counter++}`,
        role,
        name: name.trim(),
        value: value ? String(value).trim() : undefined,
        description: description ? String(description).trim() : undefined,
        disabled: disabled ? true : undefined,
        focused: focused ? true : undefined,
        selector: node.selector || `[data-a11y-id="${counter - 1}"]`,
        children: node.children ? this.parseAXNodes(node.children) : undefined
      };

      nodes.push(parsed);
    }

    return nodes;
  }

  /**
   * Formats structured A11y nodes into a compact, token-dense text hierarchy for LLMs
   * e.g.:
   * [el_1] button "Generate Video" (disabled) -> #btn_generate
   * [el_2] textbox "Enter prompt..." value="Quantum physics" (focused) -> #prompt_box
   */
  public formatCompactTree(nodes: SemanticA11yNode[], indent = 0): string {
    const lines: string[] = [];
    const prefix = "  ".repeat(indent);

    for (const node of nodes) {
      let line = `${prefix}[${node.id}] <${node.role}>`;
      if (node.name) line += ` "${node.name}"`;
      if (node.value) line += ` value="${node.value}"`;
      if (node.focused) line += ` (focused)`;
      if (node.disabled) line += ` (disabled)`;
      if (node.description) line += ` desc="${node.description}"`;
      if (node.selector && node.selector !== `[data-a11y-id]`) line += ` -> ${node.selector}`;

      lines.push(line);

      if (node.children && node.children.length > 0) {
        lines.push(this.formatCompactTree(node.children, indent + 1));
      }
    }

    return lines.join("\n");
  }

  /**
   * Produces a full accessibility snapshot with calculated token efficiency metrics
   */
  public createSnapshot(url: string, title: string, rawNodes: any[], rawHtmlLength = 0): A11yTreeSnapshot {
    const tree = this.parseAXNodes(rawNodes);
    const compactText = this.formatCompactTree(tree);

    // Calculate approximate token savings vs raw HTML dump (1 token ~ 4 chars)
    const estimatedRawTokens = Math.max(1, Math.round(rawHtmlLength / 4));
    const estimatedA11yTokens = Math.max(1, Math.round(compactText.length / 4));
    const savingsPercent = rawHtmlLength > 0
      ? Math.max(0, Math.round(((estimatedRawTokens - estimatedA11yTokens) / estimatedRawTokens) * 100))
      : 85;

    return {
      url,
      title,
      totalElements: tree.length,
      tree,
      compactText,
      tokenSavingsPercent: savingsPercent
    };
  }
}
