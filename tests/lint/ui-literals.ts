import ts from 'typescript';

export interface UiLiteral {
  line: number;
  text: string;
}

const HAS_LETTER = /\p{L}/u;
const TEXT_ATTRS = new Set(['aria-label', 'title', 'alt', 'placeholder', 'label']);

function isTextNode(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

/** Cari teks antarmuka yang tertanam di JSX (F-06.3). */
export function scanUiLiterals(source: string, fileName: string): UiLiteral[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: UiLiteral[] = [];
  const report = (node: ts.Node, text: string): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({ line: line + 1, text: text.trim() });
  };

  // Nilai string berhuruf langsung di objek literal; argumen pemanggilan fungsi (kunci pesan) dilewati.
  const checkObjectValues = (node: ts.Node): void => {
    if (isTextNode(node) && HAS_LETTER.test(node.text)) report(node, node.text);
    else if (!ts.isCallExpression(node)) ts.forEachChild(node, checkObjectValues);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && HAS_LETTER.test(node.text)) {
      report(node, node.text);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const init = node.initializer;
      if (init && TEXT_ATTRS.has(name)) {
        const value = ts.isJsxExpression(init) ? init.expression : init;
        if (value && isTextNode(value) && HAS_LETTER.test(value.text)) report(value, value.text);
      } else if (init && name === 'labels' && ts.isJsxExpression(init) && init.expression) {
        const expr = init.expression;
        if (ts.isObjectLiteralExpression(expr)) {
          for (const prop of expr.properties) {
            if (ts.isPropertyAssignment(prop)) checkObjectValues(prop.initializer);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
