import ts from 'typescript';

export interface UiLiteral {
  line: number;
  text: string;
}

const HAS_LETTER = /\p{L}/u;

/** Atribut yang nilainya dibaca pengguna (termasuk pembaca layar). */
const TEXT_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'title',
  'alt',
  'placeholder',
  'label',
  'text',
  'heading',
  'caption',
]);
/** Prop camelCase berakhiran Label/Text/Title, mis. `buttonLabel`. */
const TEXT_PROP_SUFFIX = /^[a-z][A-Za-z0-9]*(Label|Text|Title)$/;
const LABELS_PROP = /^(labels|[a-z][A-Za-z0-9]*Labels)$/;

const COMPARISON_OPS = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/**
 * Cakupan dan keterbatasan (F-06.3):
 * - Hanya file `.tsx` yang dipindai. File `.ts` (konstanta, data) ditunda: teks di sana
 *   tidak bisa dibedakan dari kunci atau konten tanpa analisis aliran data (issue #35).
 * - `labels={IDENT}` diresolusi lewat cakupan terdekat: dari titik pemakaian naik ke leluhur
 *   (blok, file, badan fungsi) dan memakai deklarasi bernama IDENT pertama yang berada langsung
 *   di statement cakupan itu, bila berupa `const` berinisialisasi objek literal. Identifier dari
 *   impor, parameter, `props.labels`, atau deklarasi yang bukan objek literal tidak dilaporkan.
 *   Temuan dari const yang diresolusi melaporkan baris deklarasinya, bukan baris pemakaian.
 * - Panggilan `m.<nama>(...)` (Paraglide) dilewati seluruhnya; panggilan lain tidak dilewati.
 * - Perbandingan (`===`, `!==`, `==`, `!=`), kondisi ternary, sisi kiri `&&`, dan akses elemen
 *   (`x['kunci']`) dianggap logika, bukan teks.
 * - Belum dicakup (ditunda, issue #35): spread di dalam `labels`; `.map`/array di anak JSX;
 *   fungsi atau shorthand di dalam `labels`; const string yang diteruskan ke atribut teks
 *   (`title={TITLE}`); nama prop `description`, `message`, `tooltip`; dan file `.ts`.
 */
function isParaglideCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'm'
  );
}

/** Cari teks antarmuka tertanam di JSX (F-06.3). */
export function scanUiLiterals(source: string, fileName: string): UiLiteral[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: UiLiteral[] = [];
  const report = (node: ts.Node, text: string): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({ line: line + 1, text: text.trim() });
  };

  const unwrap = (e: ts.Expression): ts.Expression => {
    let cur = e;
    while (
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isSatisfiesExpression(cur)
    ) {
      cur = cur.expression;
    }
    return cur;
  };

  // Cakupan terdekat: deklarasi pertama bernama `name` langsung di statement cakupan leluhur.
  const resolveConstObject = (
    use: ts.Node,
    name: string,
  ): ts.ObjectLiteralExpression | undefined => {
    for (let scope: ts.Node | undefined = use.parent; scope; scope = scope.parent) {
      let statements: readonly ts.Statement[] | undefined;
      if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope)) {
        statements = scope.statements;
      } else if (ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
        statements = scope.statements;
      }
      if (!statements) continue;
      for (const st of statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const decl of st.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
          const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
          const init = decl.initializer && unwrap(decl.initializer);
          return isConst && init && ts.isObjectLiteralExpression(init) ? init : undefined;
        }
      }
    }
    return undefined;
  };

  /**
   * Laporkan string/template berhuruf di ekspresi. `children` = true membatasi ke bentuk
   * yang dijangkau anak JSX (literal, template, ternary, biner, kurung); false menjelajah
   * juga panggilan, objek, dan array (nilai atribut teks dan `labels`).
   */
  const checkExpr = (node: ts.Node, children: boolean): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (HAS_LETTER.test(node.text)) report(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
      if (HAS_LETTER.test(parts)) report(node, parts);
      for (const span of node.templateSpans) checkExpr(span.expression, children);
    } else if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      checkExpr(node.expression, children);
    } else if (ts.isConditionalExpression(node)) {
      checkExpr(node.whenTrue, children);
      checkExpr(node.whenFalse, children);
    } else if (ts.isBinaryExpression(node)) {
      if (COMPARISON_OPS.has(node.operatorToken.kind)) return;
      if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
        checkExpr(node.left, children);
      }
      checkExpr(node.right, children);
    } else if (children) {
      return;
    } else if (ts.isCallExpression(node)) {
      if (isParaglideCall(node)) return;
      for (const arg of node.arguments) checkExpr(arg, children);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) checkExpr(prop.initializer, children);
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) checkExpr(el, children);
    }
    // Lainnya (identifier, akses properti/elemen, fungsi, elemen JSX) tidak dianalisis;
    // elemen JSX dijangkau oleh visit() agar tidak dilaporkan dua kali.
  };

  const checkLabels = (expr: ts.Expression): void => {
    const target = unwrap(expr);
    if (ts.isObjectLiteralExpression(target)) checkExpr(target, false);
    else if (ts.isIdentifier(target)) {
      const resolved = resolveConstObject(target, target.text);
      if (resolved) checkExpr(resolved, false);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && HAS_LETTER.test(node.text)) {
      report(node, node.text);
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      checkExpr(node.expression, true);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const init = node.initializer;
      if (init) {
        const value = ts.isJsxExpression(init) ? init.expression : init;
        if (value) {
          if (TEXT_ATTRS.has(name) || TEXT_PROP_SUFFIX.test(name)) checkExpr(value, false);
          else if (LABELS_PROP.test(name)) checkLabels(value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
