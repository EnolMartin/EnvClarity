import ts from "typescript";
import type { AnalysisInput, AnalysisResult, VariableReference } from "./types.js";

function isProcessEnvironment(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "process"
    && node.name.text === "env";
}

/** Extract literal Node references from source text without resolving or executing modules. */
export function analyze(input: AnalysisInput): AnalysisResult {
  const source = ts.createSourceFile(input.path, input.content, ts.ScriptTarget.Latest, false);
  const references: VariableReference[] = [];
  const pending: ts.Node[] = [source];

  while (pending.length > 0) {
    const node = pending.pop()!;
    let name: string | undefined;

    if (ts.isPropertyAccessExpression(node)
      && isProcessEnvironment(node.expression)
      && ts.isIdentifier(node.name)) {
      name = node.name.text;
    } else if (ts.isElementAccessExpression(node)
      && isProcessEnvironment(node.expression)
      && ts.isStringLiteral(node.argumentExpression)) {
      name = node.argumentExpression.text;
    }

    if (name !== undefined) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      references.push({
        name,
        origin: "process.env",
        location: { path: input.path, line: position.line + 1, column: position.character + 1 },
      });
    }

    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => { children.push(child); });
    for (const child of children.reverse()) {
      pending.push(child);
    }
  }

  // Vite references and unresolved computed accesses belong to later steps.
  return { references, dynamicReferences: [] };
}
