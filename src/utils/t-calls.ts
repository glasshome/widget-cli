import { Node, Project, SyntaxKind } from "ts-morph";

export interface TCall {
  line: number;
  key: string | null;
}

const SDK = "@glasshome/widget-sdk";
const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });

const isUseTranslation = (node: Node | undefined): boolean =>
  node !== undefined &&
  Node.isCallExpression(node) &&
  node.getExpression().getText() === "useTranslation";

export function findTCalls(fileName: string, text: string): TCall[] {
  const file = project.createSourceFile(fileName, text, { overwrite: true });
  const functions = new Set<string>();
  const translators = new Set<string>();

  for (const decl of file.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== SDK) continue;
    for (const spec of decl.getNamedImports()) {
      if (spec.getName() === "t") functions.add(spec.getAliasNode()?.getText() ?? "t");
    }
  }
  for (const decl of file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (!isUseTranslation(decl.getInitializer())) continue;
    const name = decl.getNameNode();
    if (Node.isIdentifier(name)) translators.add(name.getText());
    else if (Node.isObjectBindingPattern(name)) {
      for (const element of name.getElements()) {
        const source = element.getPropertyNameNode()?.getText() ?? element.getName();
        if (source === "t") functions.add(element.getName());
      }
    }
  }

  const calls: TCall[] = [];
  for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const isT = Node.isIdentifier(callee)
      ? functions.has(callee.getText())
      : Node.isPropertyAccessExpression(callee) &&
        callee.getName() === "t" &&
        (translators.has(callee.getExpression().getText()) ||
          isUseTranslation(callee.getExpression()));
    if (!isT) continue;
    const arg = call.getArguments()[0];
    const literal =
      arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))
        ? arg.getLiteralValue()
        : null;
    calls.push({ line: call.getStartLineNumber(), key: literal });
  }
  return calls;
}
