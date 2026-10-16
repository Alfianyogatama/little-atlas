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
/** Tambahan khusus atribut JSX (bukan kunci objek, karena `message`/`description` umum di data). */
const JSX_TEXT_ATTRS = new Set(['description', 'message', 'tooltip', 'children']);
/** Properti elemen DOM yang tampil ke pengguna. */
const TEXT_SINK_PROPS = new Set([
  'textContent',
  'innerText',
  'title',
  'ariaLabel',
  'placeholder',
  'alt',
]);
const DIALOG_FNS = new Set(['alert', 'confirm', 'prompt']);
const LABELS_PROP = /^(labels|[a-z][A-Za-z0-9]*Labels)$/;

const COMPARISON_OPS = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/**
 * Cakupan dan keterbatasan (F-06.3):
 * - File `.ts` dan `.tsx` dipindai. Aturan berbasis kunci dan sink berlaku di keduanya: nilai
 *   properti objek berkunci teks (TEXT_ATTRS atau akhiran Label/Text/Title), assignment ke
 *   `.textContent/.innerText/.title/.ariaLabel/.placeholder/.alt`, `setAttribute(<atribut teks>, ...)`,
 *   `new SpeechSynthesisUtterance(...)`, dan `alert/confirm/prompt(...)`. Error, console, Zod,
 *   serta kunci `message`/`description` di objek tidak dilaporkan.
 * - Atribut JSX `description`, `message`, `tooltip`, `children` dihitung teks; `value` hanya pada
 *   `<input type="submit|button">`.
 * - `labels={IDENT}` diresolusi lewat cakupan terdekat: dari titik pemakaian naik ke leluhur
 *   (blok, file, badan fungsi) dan memakai deklarasi bernama IDENT pertama yang berada langsung
 *   di statement cakupan itu, bila berupa `const` berinisialisasi objek literal (labels) atau
 *   string/template (identifier di atribut teks, anak JSX, dan nilai berkunci teks). Bayangan
 *   nama dihormati: bila di jalur naik bertemu pengikat bernama sama (parameter fungsi termasuk
 *   destrukturisasi dan default, let/var, const destrukturisasi, variabel `for`, parameter
 *   `catch`, deklarasi fungsi/kelas), resolusi berhenti tanpa laporan. Identifier dari impor,
 *   `props.labels`, atau deklarasi lain tidak dilaporkan. Temuan dari const yang diresolusi
 *   melaporkan baris deklarasinya, bukan baris pemakaian.
 * - Panggilan `m.<nama>(...)` (Paraglide) dilewati seluruhnya; panggilan lain tidak dilewati.
 * - Perbandingan (`===`, `!==`, `==`, `!=`), kondisi ternary, sisi kiri `&&`, dan akses elemen
 *   (`x['kunci']`) dianggap logika, bukan teks.
 * - Di dalam `labels`: spread (`...{ }` inline, `...IDENT` const objek lokal), nilai fungsi dan
 *   method (ekspresi return dicek, tanpa masuk fungsi bersarang), dan shorthand `{ close }`
 *   (const string/template lokal). Const string/template yang dipakai di atribut teks atau anak
 *   JSX (`title={TITLE}`, `{GREETING}`) melaporkan baris deklarasinya; `let`, impor, dan hasil
 *   panggilan tidak.
 * - Anak JSX: panggilan `.map`/`.flatMap` (ekspresi return callback dicek dalam mode anak JSX,
 *   tanpa masuk fungsi bersarang) dan array literal langsung (tiap elemen dicek).
 * - Belum dicakup (ditunda, issue deferred baru): array penerima `.map` (`['JP'].map(...)`),
 *   `.join()`, resolusi const/impor lintas file, alarm palsu prop enum berakhiran
 *   Text/Title (mis. `preferredText="auto"`), `window.alert(...)`,
 *   `new window.SpeechSynthesisUtterance(...)`, assignment `utterance.text = ...`, dan alarm
 *   palsu di nilai berkunci teks karena argumen panggilan dan objek bersarang ikut dijelajah
 *   (mis. `{ label: n.toLocaleString('id-ID') }`).
 */
function isParaglideCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'm'
  );
}

/** Cari teks antarmuka tertanam di JSX, kunci teks, dan sink DOM/dialog/suara (F-06.3). */
export function scanUiLiterals(source: string, fileName: string): UiLiteral[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found: UiLiteral[] = [];
  const reported = new Set<ts.Node>();
  const report = (node: ts.Node, text: string): void => {
    if (reported.has(node)) return;
    reported.add(node);
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

  const bindingNames = (name: ts.BindingName, out: Set<string>): void => {
    if (ts.isIdentifier(name)) {
      out.add(name.text);
      return;
    }
    for (const el of name.elements) {
      if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
    }
  };

  // Cakupan terdekat: dari titik pemakaian naik ke leluhur. Berhenti (undefined) bila bertemu
  // pengikat `name` yang bukan const identifier (parameter, destrukturisasi, variabel for,
  // catch, let/var). Mengembalikan inisialisasi bila `const name = ...` langsung di statement
  // cakupan.
  const resolveConstInit = (use: ts.Node, name: string): ts.Expression | undefined => {
    const binds = (list: ts.VariableDeclarationList | undefined): boolean => {
      if (!list) return false;
      const names = new Set<string>();
      for (const d of list.declarations) bindingNames(d.name, names);
      return names.has(name);
    };
    for (let scope: ts.Node | undefined = use.parent; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope)) {
        const names = new Set<string>();
        for (const p of scope.parameters) bindingNames(p.name, names);
        if (names.has(name)) return undefined;
      } else if (ts.isCatchClause(scope)) {
        const names = new Set<string>();
        if (scope.variableDeclaration) bindingNames(scope.variableDeclaration.name, names);
        if (names.has(name)) return undefined;
      } else if (ts.isForStatement(scope)) {
        if (scope.initializer && ts.isVariableDeclarationList(scope.initializer)) {
          if (binds(scope.initializer)) return undefined;
        }
      } else if (ts.isForOfStatement(scope) || ts.isForInStatement(scope)) {
        if (ts.isVariableDeclarationList(scope.initializer) && binds(scope.initializer)) {
          return undefined;
        }
      }
      let statements: readonly ts.Statement[] | undefined;
      if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope)) {
        statements = scope.statements;
      } else if (ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
        statements = scope.statements;
      }
      if (!statements) continue;
      for (const st of statements) {
        if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) {
          if (st.name?.text === name) return undefined;
          continue;
        }
        if (!ts.isVariableStatement(st)) continue;
        for (const decl of st.declarationList.declarations) {
          const names = new Set<string>();
          bindingNames(decl.name, names);
          if (!names.has(name)) continue;
          const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
          return isConst && ts.isIdentifier(decl.name) && decl.initializer
            ? unwrap(decl.initializer)
            : undefined;
        }
      }
    }
    return undefined;
  };
  const resolveConstObject = (
    use: ts.Node,
    name: string,
  ): ts.ObjectLiteralExpression | undefined => {
    const init = resolveConstInit(use, name);
    return init && ts.isObjectLiteralExpression(init) ? init : undefined;
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
    } else if (ts.isIdentifier(node)) {
      // const string/template di file yang sama: lapor baris deklarasi.
      const init = resolveConstInit(node, node.text);
      if (init && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))) {
        if (HAS_LETTER.test(init.text)) report(init, init.text);
      }
    } else if (children && ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) checkExpr(el, true);
    } else if (children && ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        (callee.name.text === 'map' || callee.name.text === 'flatMap')
      ) {
        const cb = node.arguments[0] && unwrap(node.arguments[0]);
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
          checkFunctionResult(cb, true);
        }
      }
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
    // Lainnya (akses properti/elemen, fungsi, elemen JSX) tidak dianalisis; identifier hanya
    // diresolusi ke const string/template di file yang sama;
    // elemen JSX dijangkau oleh visit() agar tidak dilaporkan dua kali.
  };

  const keyName = (name: ts.PropertyName): string | undefined =>
    ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
  const isTextKey = (k: string): boolean => TEXT_ATTRS.has(k) || TEXT_PROP_SUFFIX.test(k);

  const checkFunctionResult = (fn: ts.FunctionLikeDeclaration, children = false): void => {
    const body = fn.body;
    if (!body) return;
    if (!ts.isBlock(body)) {
      checkExpr(body, children);
      return;
    }
    const walk = (n: ts.Node): void => {
      if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
      if (ts.isReturnStatement(n)) {
        if (n.expression) checkExpr(n.expression, children);
        return;
      }
      ts.forEachChild(n, walk);
    };
    ts.forEachChild(body, walk);
  };

  const checkLabelsObject = (obj: ts.ObjectLiteralExpression, seen: Set<ts.Node>): void => {
    if (seen.has(obj)) return;
    seen.add(obj);
    for (const prop of obj.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const v = unwrap(prop.initializer);
        if (ts.isArrowFunction(v) || ts.isFunctionExpression(v)) checkFunctionResult(v);
        else checkExpr(prop.initializer, false);
      } else if (ts.isMethodDeclaration(prop)) {
        checkFunctionResult(prop);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        checkExpr(prop.name, false);
      } else if (ts.isSpreadAssignment(prop)) {
        const v = unwrap(prop.expression);
        if (ts.isObjectLiteralExpression(v)) checkLabelsObject(v, seen);
        else if (ts.isIdentifier(v)) {
          const resolved = resolveConstObject(v, v.text);
          if (resolved) checkLabelsObject(resolved, seen);
        }
      }
    }
  };

  const checkLabels = (expr: ts.Expression): void => {
    const target = unwrap(expr);
    if (ts.isObjectLiteralExpression(target)) checkLabelsObject(target, new Set());
    else if (ts.isIdentifier(target)) {
      const resolved = resolveConstObject(target, target.text);
      if (resolved) checkLabelsObject(resolved, new Set());
    }
  };

  // `<b {...L} />`: kunci teks di const objek yang diresolusi.
  const checkJsxSpread = (expr: ts.Expression): void => {
    const target = unwrap(expr);
    if (!ts.isIdentifier(target)) return;
    const resolved = resolveConstObject(target, target.text);
    if (!resolved) return;
    for (const prop of resolved.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const k = keyName(prop.name);
      if (k !== undefined && (isTextKey(k) || JSX_TEXT_ATTRS.has(k))) {
        checkExpr(prop.initializer, false);
      }
    }
  };

  const inputType = (attr: ts.JsxAttribute): string | undefined => {
    const el = attr.parent.parent;
    if (!ts.isJsxOpeningElement(el) && !ts.isJsxSelfClosingElement(el)) return undefined;
    if (el.tagName.getText(sf) !== 'input') return undefined;
    for (const p of el.attributes.properties) {
      if (ts.isJsxAttribute(p) && p.name.getText(sf) === 'type' && p.initializer) {
        return ts.isStringLiteral(p.initializer) ? p.initializer.text : undefined;
      }
    }
    return undefined;
  };

  const checkSinks = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const k = keyName(node.name);
      if (k !== undefined && isTextKey(k)) checkExpr(node.initializer, false);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      TEXT_SINK_PROPS.has(node.left.name.text)
    ) {
      checkExpr(node.right, false);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const [a0, a1] = node.arguments;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'setAttribute' &&
        a0 &&
        a1 &&
        (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) &&
        TEXT_ATTRS.has(a0.text)
      ) {
        checkExpr(a1, false);
      } else if (ts.isIdentifier(callee) && DIALOG_FNS.has(callee.text) && a0) {
        checkExpr(a0, false);
      }
    } else if (ts.isNewExpression(node)) {
      const a0 = node.arguments?.[0];
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'SpeechSynthesisUtterance' &&
        a0
      ) {
        checkExpr(a0, false);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    checkSinks(node);
    if (ts.isJsxText(node) && HAS_LETTER.test(node.text)) {
      report(node, node.text);
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      checkExpr(node.expression, true);
    } else if (ts.isJsxSpreadAttribute(node)) {
      checkJsxSpread(node.expression);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const init = node.initializer;
      if (init) {
        const value = ts.isJsxExpression(init) ? init.expression : init;
        if (value) {
          if (isTextKey(name) || JSX_TEXT_ATTRS.has(name)) checkExpr(value, false);
          else if (name === 'value' && ['submit', 'button'].includes(inputType(node) ?? '')) {
            checkExpr(value, false);
          } else if (LABELS_PROP.test(name)) checkLabels(value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
