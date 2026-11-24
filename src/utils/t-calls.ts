import { Node, Project, SyntaxKind } from "ts-morph";

export interface TCall {
  line: number;
  key: string | null;
}

const SDK = "@glasshome/widget-sdk";
const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });

interface SdkNames {
  hooks: Set<string>;
  namespaces: Set<string>;
}

const isUseTranslation = (node: Node | undefined, sdk: SdkNames): boolean => {
  if (node === undefined || !Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  if (Node.isIdentifier(callee)) return sdk.hooks.has(callee.getText());
  return (
    Node.isPropertyAccessExpression(callee) &&
    callee.getName() === "useTranslation" &&
    sdk.namespaces.has(callee.getExpression().getText())
  );
};

export function findTCalls(fileName: string, text: string): TCall[] {
  const file = project.createSourceFile(fileName, text, { overwrite: true });
  const functions = new Set<string>();
  const translators = new Set<string>();
  const sdk: SdkNames = { hooks: new Set(), namespaces: new Set() };

  for (const decl of file.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== SDK) continue;
    const namespace = decl.getNamespaceImport();
    if (namespace) sdk.namespaces.add(namespace.getText());
    for (const spec of decl.getNamedImports()) {
      const local = spec.getAliasNode()?.getText() ?? spec.getName();
      if (spec.getName() === "t") functions.add(local);
      if (spec.getName() === "useTranslation") sdk.hooks.add(local);
    }
  }
  for (const decl of file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (!isUseTranslation(decl.getInitializer(), sdk)) continue;
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
          isUseTranslation(callee.getExpression(), sdk));
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
