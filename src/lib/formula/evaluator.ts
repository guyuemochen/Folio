/**
 * Formula evaluator for `formula`-type database properties (Notion-like).
 *
 * Pure, dependency-free, and sandboxed — no `eval` / `new Function`. A
 * formula is tokenized → parsed (Pratt) into an AST → evaluated against a
 * per-row context. Errors throw {@link FormulaError}; callers surface them
 * in the cell.
 *
 * Grammar (precedence low → high):
 *   or        := and  ( "||" and )*
 *   and       := eq   ( "&&" eq )*
 *   eq        := cmp  ( "==" | "!=" ) cmp
 *   cmp       := add  ( "<" | "<=" | ">" | ">=" ) add
 *   add       := mul  ( "+" | "-" ) mul
 *   mul       := unary( "*" | "/" | "%" ) unary
 *   unary     := ("!" | "-") unary | primary
 *   primary   := number | string | true | false
 *              | "prop" "(" string ")"
 *              | ident "(" args? ")"
 *              | "(" or ")"
 *
 * Values: number | string | boolean | null. Coercion is JS-like:
 *   - `+` concatenates if either side is a string, else numeric add.
 *   - arithmetic (- * / %) and comparisons coerce to number.
 *   - truthiness: null / 0 / "" / false are falsy.
 */

/** A value the evaluator can produce or consume. */
export type FormulaValue = number | string | boolean | null;

/** Thrown on tokenization / parse / evaluation failure. */
export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

/** Per-row lookup: resolve a property *name* to its raw cell value. */
export type PropResolver = (name: string) => FormulaValue;

// =============================================================================
// Tokenizer
// =============================================================================

type TokenType =
  | 'number'
  | 'string'
  | 'ident'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'eof';

interface Token {
  type: TokenType;
  /** Literal text (number source, string content already unquoted, ident name, op symbol). */
  value: string;
  pos: number;
}

const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '<', '>', '!']);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i]!;
    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    // line comments: // ...
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    const start = i;
    // number: digits with optional single decimal point
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1] ?? ''))) {
      let num = '';
      while (i < n && (isDigit(src[i]!) || src[i] === '.')) {
        num += src[i];
        i++;
      }
      tokens.push({ type: 'number', value: num, pos: start });
      continue;
    }
    // string literal (double or single quotes, no escapes beyond \" \\)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let str = '';
      let closed = false;
      while (i < n) {
        const c = src[i]!;
        if (c === '\\' && i + 1 < n) {
          const next = src[i + 1]!;
          str += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          i++;
          break;
        }
        str += c;
        i++;
      }
      if (!closed) throw new FormulaError('未闭合的字符串字面量');
      tokens.push({ type: 'string', value: str, pos: start });
      continue;
    }
    // identifier: letter / _ then letters, digits, _
    if (isIdentStart(ch)) {
      let id = '';
      while (i < n && isIdentPart(src[i]!)) {
        id += src[i];
        i++;
      }
      tokens.push({ type: 'ident', value: id, pos: start });
      continue;
    }
    // two-char operators
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: 'op', value: two, pos: start });
      i += 2;
      continue;
    }
    // single-char operators
    if (ONE_CHAR_OPS.has(ch)) {
      tokens.push({ type: 'op', value: ch, pos: start });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch, pos: start });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch, pos: start });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch, pos: start });
      i++;
      continue;
    }
    throw new FormulaError(`无法识别的字符 “${ch}”`);
  }
  tokens.push({ type: 'eof', value: '', pos: i });
  return tokens;
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isIdentStart = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

// =============================================================================
// AST
// =============================================================================

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'prop'; name: string }
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'unary'; op: '!' | '-'; operand: Node }
  | { t: 'binary'; op: string; left: Node; right: Node };

// =============================================================================
// Parser (Pratt-ish by precedence climbing)
// =============================================================================

class Parser {
  private tokens: Token[];
  private pos = 0;
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }
  private peek(): Token {
    return this.tokens[this.pos]!;
  }
  private next(): Token {
    return this.tokens[this.pos++]!;
  }
  private expect(type: TokenType, value?: string): Token {
    const tk = this.peek();
    if (tk.type !== type || (value !== undefined && tk.value !== value)) {
      throw new FormulaError(
        `解析错误：期望 ${value ?? type}，但得到 “${tk.value || tk.type}”`,
      );
    }
    return this.next();
  }

  parse(): Node {
    const node = this.parseOr();
    if (this.peek().type !== 'eof') {
      throw new FormulaError(`解析错误：多余的输入 “${this.peek().value}”`);
    }
    return node;
  }

  private parseBinary(level: number, next: () => Node): Node {
    const ops = LEVELS[level]!;
    let left = next();
    for (;;) {
      const tk = this.peek();
      if (tk.type === 'op' && ops.has(tk.value)) {
        this.next();
        const right = next();
        left = { t: 'binary', op: tk.value, left, right };
      } else {
        return left;
      }
    }
  }
  private parseOr(): Node {
    return this.parseBinary(0, () => this.parseAnd());
  }
  private parseAnd(): Node {
    return this.parseBinary(1, () => this.parseEq());
  }
  private parseEq(): Node {
    return this.parseBinary(2, () => this.parseCmp());
  }
  private parseCmp(): Node {
    return this.parseBinary(3, () => this.parseAdd());
  }
  private parseAdd(): Node {
    return this.parseBinary(4, () => this.parseMul());
  }
  private parseMul(): Node {
    return this.parseBinary(5, () => this.parseUnary());
  }
  private parseUnary(): Node {
    const tk = this.peek();
    if (tk.type === 'op' && (tk.value === '!' || tk.value === '-')) {
      this.next();
      return { t: 'unary', op: tk.value, operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }
  private parsePrimary(): Node {
    const tk = this.peek();
    if (tk.type === 'number') {
      this.next();
      const v = Number(tk.value);
      if (Number.isNaN(v)) throw new FormulaError(`无效数字 “${tk.value}”`);
      return { t: 'num', v };
    }
    if (tk.type === 'string') {
      this.next();
      return { t: 'str', v: tk.value };
    }
    if (tk.type === 'ident') {
      this.next();
      const name = tk.value;
      // bare booleans
      if (name === 'true') return { t: 'bool', v: true };
      if (name === 'false') return { t: 'bool', v: false };
      // prop("Name") — a call whose single arg is a string literal
      if (name === 'prop') {
        this.expect('lparen');
        const arg = this.peek();
        if (arg.type !== 'string') {
          throw new FormulaError('prop() 的参数必须是字符串字面量，例如 prop("价格")');
        }
        this.next();
        this.expect('rparen');
        return { t: 'prop', name: arg.value };
      }
      // function call
      if (this.peek().type === 'lparen') {
        this.next();
        const args: Node[] = [];
        if (this.peek().type !== 'rparen') {
          args.push(this.parseOr());
          while (this.peek().type === 'comma') {
            this.next();
            args.push(this.parseOr());
          }
        }
        this.expect('rparen');
        return { t: 'call', name: name.toLowerCase(), args };
      }
      throw new FormulaError(`无法识别的标识符 “${name}”（如需引用列，请使用 prop("列名")）`);
    }
    if (tk.type === 'lparen') {
      this.next();
      const inner = this.parseOr();
      this.expect('rparen');
      return inner;
    }
    throw new FormulaError(`解析错误：意外的 “${tk.value || tk.type}”`);
  }
}

// binary operator precedence levels (low → high)
const LEVELS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['||']),
  new Set(['&&']),
  new Set(['==', '!=']),
  new Set(['<', '<=', '>', '>=']),
  new Set(['+', '-']),
  new Set(['*', '/', '%']),
];

// =============================================================================
// Evaluator
// =============================================================================

/** Truthiness: null / 0 / "" / false → false. */
function isTruthy(v: FormulaValue): boolean {
  if (v === null || v === false) return false;
  if (v === 0) return false;
  if (v === '') return false;
  return true;
}

/** Coerce a value to a number. Throws FormulaError on non-numeric strings. */
function toNum(v: FormulaValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null) return 0;
  const n = Number(v);
  if (v !== '' && Number.isNaN(n)) {
    throw new FormulaError(`无法将 “${v}” 转换为数字`);
  }
  return n;
}

function toStr(v: FormulaValue): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function evaluate(node: Node, resolve: PropResolver): FormulaValue {
  switch (node.t) {
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case 'bool':
      return node.v;
    case 'prop':
      return resolve(node.name);
    case 'unary': {
      if (node.op === '!') return !isTruthy(evaluate(node.operand, resolve));
      return -toNum(evaluate(node.operand, resolve));
    }
    case 'call':
      return evalCall(node.name, node.args, resolve);
    case 'binary': {
      const op = node.op;
      // short-circuit logic
      if (op === '&&') {
        return isTruthy(evaluate(node.left, resolve))
          ? evaluate(node.right, resolve)
          : false;
      }
      if (op === '||') {
        return isTruthy(evaluate(node.left, resolve))
          ? evaluate(node.left, resolve)
          : evaluate(node.right, resolve);
      }
      const l = evaluate(node.left, resolve);
      const r = evaluate(node.right, resolve);
      switch (op) {
        case '+':
          // string concat if either side is a non-null string
          if (typeof l === 'string' || typeof r === 'string') {
            return toStr(l) + toStr(r);
          }
          return toNum(l) + toNum(r);
        case '-':
          return toNum(l) - toNum(r);
        case '*':
          return toNum(l) * toNum(r);
        case '/': {
          const d = toNum(r);
          if (d === 0) throw new FormulaError('除以零');
          return toNum(l) / d;
        }
        case '%': {
          const d = toNum(r);
          if (d === 0) throw new FormulaError('除以零');
          return toNum(l) % d;
        }
        case '==':
          return looseEq(l, r);
        case '!=':
          return !looseEq(l, r);
        case '<':
          return compare(l, r) < 0;
        case '<=':
          return compare(l, r) <= 0;
        case '>':
          return compare(l, r) > 0;
        case '>=':
          return compare(l, r) >= 0;
        default:
          throw new FormulaError(`未知运算符 “${op}”`);
      }
    }
  }
}

function looseEq(l: FormulaValue, r: FormulaValue): boolean {
  if (typeof l === typeof r) return l === r;
  // mixed number/string: compare numerically when possible
  if (typeof l === 'number' || typeof r === 'number') return toNum(l) === toNum(r);
  return toStr(l) === toStr(r);
}

/** Total comparison ordering; nulls sort first. */
function compare(a: FormulaValue, b: FormulaValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === 'number' || typeof b === 'number') {
    return toNum(a) - toNum(b);
  }
  const as = toStr(a);
  const bs = toStr(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function evalCall(name: string, args: Node[], resolve: PropResolver): FormulaValue {
  // `if` is a lazy special form: only the chosen branch is evaluated.
  if (name === 'if') {
    if (args.length < 2 || args.length > 3) {
      throw new FormulaError('if() 需要 2 或 3 个参数：if(条件, 真值, 假值?)');
    }
    const cond = isTruthy(evaluate(args[0]!, resolve));
    if (cond) return evaluate(args[1]!, resolve);
    return args.length === 3 ? evaluate(args[2]!, resolve) : null;
  }

  const ev = (n: Node) => evaluate(n, resolve);

  switch (name) {
    case 'round': {
      const x = toNum(ev(args[0] ?? { t: 'num', v: 0 }));
      const digits = args[1] !== undefined ? toNum(ev(args[1])) : 0;
      const f = Math.pow(10, digits);
      return Math.round(x * f) / f;
    }
    case 'floor':
      return Math.floor(toNum(ev(args[0] ?? { t: 'num', v: 0 })));
    case 'ceil':
      return Math.ceil(toNum(ev(args[0] ?? { t: 'num', v: 0 })));
    case 'abs':
      return Math.abs(toNum(ev(args[0] ?? { t: 'num', v: 0 })));
    case 'min':
      return Math.min(...args.map((a) => toNum(ev(a))));
    case 'max':
      return Math.max(...args.map((a) => toNum(ev(a))));
    case 'sum':
      return args.reduce<number>((acc, a) => acc + toNum(ev(a)), 0);
    case 'concat':
      return args.map((a) => toStr(ev(a))).join('');
    case 'length':
      return toStr(ev(args[0] ?? { t: 'str', v: '' })).length;
    case 'tonumber':
      return toNum(ev(args[0] ?? { t: 'num', v: 0 }));
    case 'tostring':
      return toStr(ev(args[0] ?? { t: 'str', v: '' }));
    case 'upper':
      return toStr(ev(args[0] ?? { t: 'str', v: '' })).toUpperCase();
    case 'lower':
      return toStr(ev(args[0] ?? { t: 'str', v: '' })).toLowerCase();
    case 'contains': {
      const h = ev(args[0] ?? { t: 'str', v: '' });
      const n = ev(args[1] ?? { t: 'str', v: '' });
      return toStr(h).includes(toStr(n));
    }
    case 'now':
      return new Date().toISOString();
    case 'year':
      return datePart(ev(args[0] ?? { t: 'str', v: '' }), 0);
    case 'month':
      return datePart(ev(args[0] ?? { t: 'str', v: '' }), 1);
    case 'day':
      return datePart(ev(args[0] ?? { t: 'str', v: '' }), 2);
    case 'timestamp':
      return new Date(toStr(ev(args[0] ?? { t: 'str', v: '' }))).getTime();
    default:
      throw new FormulaError(`未知函数 “${name}()”`);
  }
}

function datePart(v: FormulaValue, part: 0 | 1 | 2): number {
  const d = new Date(toStr(v));
  if (Number.isNaN(d.getTime())) throw new FormulaError(`无效日期 “${toStr(v)}”`);
  if (part === 0) return d.getFullYear();
  if (part === 1) return d.getMonth() + 1;
  return d.getDate();
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Evaluate a formula against a property-name → value resolver.
 *
 * @param formula The expression source, e.g. `prop("Price") * prop("Qty")`.
 * @param resolve Returns the raw cell value for a referenced property name.
 * @returns The computed value, or `null` on a *soft* miss (empty/null
 *   references that make the result meaningless). Hard errors throw
 *   {@link FormulaError}.
 */
export function evalFormula(formula: string, resolve: PropResolver): FormulaValue {
  const src = formula.trim();
  if (src.length === 0) return null;
  const tokens = tokenize(src);
  const ast = new Parser(tokens).parse();
  return evaluate(ast, resolve);
}

/**
 * Compile-time check: returns an error message if the formula is invalid,
 * otherwise `null`. Used by the property menu to show live validation as the
 * user types (no row context needed — prop() references aren't resolved).
 */
export function validateFormula(formula: string): string | null {
  try {
    const src = formula.trim();
    if (src.length === 0) return null;
    const tokens = tokenize(src);
    new Parser(tokens).parse();
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : String(e);
  }
}
