import ts from "typescript";
import type { AnalysisInput, AnalysisResult, ReferenceOrigin, VariableReference } from "./types.js";

const viteBuiltIns = new Set(["MODE", "BASE_URL", "DEV", "PROD", "SSR"]);

function environmentOrigin(node: ts.Expression): ReferenceOrigin | undefined {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "env") {
    return undefined;
  }
  if (ts.isIdentifier(node.expression) && node.expression.text === "process") {
    return "process.env";
  }
  if (ts.isMetaProperty(node.expression)
    && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.expression.name.text === "meta") {
    return "import.meta.env";
  }
  return undefined;
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Extract literal Node and Vite references without resolving or executing modules. */
export function analyze(input: AnalysisInput): AnalysisResult {
  const source = ts.createSourceFile(input.path, input.content, ts.ScriptTarget.Latest, false, scriptKind(input.path));
  const references: VariableReference[] = [];
  const pending: ts.Node[] = [source];

  while (pending.length > 0) {
    const node = pending.pop()!;
    let name: string | undefined;
    let origin: ReferenceOrigin | undefined;

    if (ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.name)) {
      name = node.name.text;
      origin = environmentOrigin(node.expression);
    } else if (ts.isElementAccessExpression(node)
      && ts.isStringLiteral(node.argumentExpression)) {
      name = node.argumentExpression.text;
      origin = environmentOrigin(node.expression);
    }

    if (name !== undefined && origin !== undefined
      && !(origin === "import.meta.env" && viteBuiltIns.has(name))) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      references.push({
        name,
        origin,
        location: { path: input.path, line: position.line + 1, column: position.character + 1 },
      });
    }

    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => { children.push(child); });
    for (const child of children.reverse()) {
      pending.push(child);
    }
  }

  // Unresolved computed accesses belong to a later step.
  return { references, dynamicReferences: [] };
}
