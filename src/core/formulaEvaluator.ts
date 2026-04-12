import type { ScalarVariables } from "./types";

export class FormulaSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaSyntaxError";
  }
}

export class FormulaEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaEvaluationError";
  }
}

type TokenType =
  | "number"
  | "identifier"
  | "plus"
  | "minus"
  | "mul"
  | "div"
  | "lparen"
  | "rparen"
  | "eof";

interface Token {
  type: TokenType;
  value?: string;
}

interface NumberNode {
  kind: "number";
  value: number;
}

interface IdentifierNode {
  kind: "identifier";
  name: string;
}

interface UnaryNode {
  kind: "unary";
  operator: "+" | "-";
  right: ExpressionNode;
}

interface BinaryNode {
  kind: "binary";
  operator: "+" | "-" | "*" | "/";
  left: ExpressionNode;
  right: ExpressionNode;
}

type ExpressionNode = NumberNode | IdentifierNode | UnaryNode | BinaryNode;

class Lexer {
  private index = 0;

  constructor(private readonly input: string) {}

  nextToken(): Token {
    this.skipWhitespace();
    const ch = this.input[this.index];

    if (!ch) return { type: "eof" };
    if (ch === "+") return this.consumeSingle("plus");
    if (ch === "-") return this.consumeSingle("minus");
    if (ch === "*") return this.consumeSingle("mul");
    if (ch === "/") return this.consumeSingle("div");
    if (ch === "(") return this.consumeSingle("lparen");
    if (ch === ")") return this.consumeSingle("rparen");

    if (this.isDigit(ch) || ch === ".") return this.readNumberToken();
    if (this.isIdentifierStart(ch)) return this.readIdentifierToken();

    throw new FormulaSyntaxError(`Unsupported character "${ch}"`);
  }

  private consumeSingle(type: TokenType): Token {
    this.index += 1;
    return { type };
  }

  private readNumberToken(): Token {
    const start = this.index;
    let dotCount = 0;

    while (this.index < this.input.length) {
      const c = this.input[this.index];
      if (c === ".") {
        dotCount += 1;
        if (dotCount > 1) {
          throw new FormulaSyntaxError("Invalid number literal");
        }
        this.index += 1;
        continue;
      }
      if (!this.isDigit(c)) break;
      this.index += 1;
    }

    const raw = this.input.slice(start, this.index);
    if (raw === ".") {
      throw new FormulaSyntaxError("Invalid number literal");
    }
    return { type: "number", value: raw };
  }

  private readIdentifierToken(): Token {
    const start = this.index;
    this.index += 1;
    while (this.index < this.input.length) {
      const c = this.input[this.index];
      if (!this.isIdentifierPart(c)) break;
      this.index += 1;
    }
    return { type: "identifier", value: this.input.slice(start, this.index) };
  }

  private skipWhitespace(): void {
    while (this.index < this.input.length) {
      const c = this.input[this.index];
      if (c !== " " && c !== "\n" && c !== "\r" && c !== "\t") break;
      this.index += 1;
    }
  }

  private isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
  }

  private isIdentifierStart(c: string): boolean {
    return c === "$" || c === "_" || /[A-Za-z]/.test(c);
  }

  private isIdentifierPart(c: string): boolean {
    return c === "_" || /[A-Za-z0-9]/.test(c);
  }
}

class Parser {
  private current: Token;

  constructor(private readonly lexer: Lexer) {
    this.current = lexer.nextToken();
  }

  parseExpression(): ExpressionNode {
    const node = this.parseAddSub();
    if (this.current.type !== "eof") {
      throw new FormulaSyntaxError("Unexpected token at end of formula");
    }
    return node;
  }

  private parseAddSub(): ExpressionNode {
    let node = this.parseMulDiv();
    while (this.current.type === "plus" || this.current.type === "minus") {
      const op = this.current.type === "plus" ? "+" : "-";
      this.eat(this.current.type);
      const right = this.parseMulDiv();
      node = { kind: "binary", operator: op, left: node, right };
    }
    return node;
  }

  private parseMulDiv(): ExpressionNode {
    let node = this.parseUnary();
    while (this.current.type === "mul" || this.current.type === "div") {
      const op = this.current.type === "mul" ? "*" : "/";
      this.eat(this.current.type);
      const right = this.parseUnary();
      node = { kind: "binary", operator: op, left: node, right };
    }
    return node;
  }

  private parseUnary(): ExpressionNode {
    if (this.current.type === "plus" || this.current.type === "minus") {
      const op = this.current.type === "plus" ? "+" : "-";
      this.eat(this.current.type);
      return { kind: "unary", operator: op, right: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    if (this.current.type === "number") {
      const raw = this.current.value as string;
      this.eat("number");
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new FormulaSyntaxError("Number literal is not finite");
      }
      return { kind: "number", value };
    }

    if (this.current.type === "identifier") {
      const name = this.current.value as string;
      this.eat("identifier");
      return { kind: "identifier", name };
    }

    if (this.current.type === "lparen") {
      this.eat("lparen");
      const expr = this.parseAddSub();
      this.eat("rparen");
      return expr;
    }

    throw new FormulaSyntaxError("Expected a number, identifier, or parentheses");
  }

  private eat(expected: TokenType): void {
    if (this.current.type !== expected) {
      throw new FormulaSyntaxError(`Expected token ${expected}, got ${this.current.type}`);
    }
    this.current = this.lexer.nextToken();
  }
}

function normalizeVariableMap(vars: ScalarVariables): ScalarVariables {
  const out: ScalarVariables = {};
  Object.entries(vars).forEach(([key, value]) => {
    if (!Number.isFinite(value)) {
      throw new FormulaEvaluationError(`Variable "${key}" is not finite`);
    }
    const normalized = key.startsWith("$") ? key.slice(1) : key;
    out[normalized] = value;
    out[`$${normalized}`] = value;
  });
  return out;
}

function evalNode(node: ExpressionNode, vars: ScalarVariables): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "identifier": {
      const normalized = node.name.startsWith("$") ? node.name.slice(1) : node.name;
      const value = vars[node.name] ?? vars[normalized] ?? vars[`$${normalized}`];
      if (value === undefined) {
        throw new FormulaEvaluationError(`Unknown variable "${node.name}"`);
      }
      return value;
    }
    case "unary": {
      const right = evalNode(node.right, vars);
      return node.operator === "-" ? -right : right;
    }
    case "binary": {
      const left = evalNode(node.left, vars);
      const right = evalNode(node.right, vars);
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          if (right === 0) throw new FormulaEvaluationError("Division by zero");
          return left / right;
        default:
          throw new FormulaEvaluationError("Unsupported operator");
      }
    }
    default:
      throw new FormulaEvaluationError("Invalid expression node");
  }
}

export function evaluateFormula(formula: string | number, variables: ScalarVariables): number {
  if (typeof formula === "number") {
    if (!Number.isFinite(formula)) {
      throw new FormulaEvaluationError("Formula number is not finite");
    }
    return formula;
  }

  const source = formula.trim();
  if (!source) throw new FormulaSyntaxError("Formula cannot be empty");

  const parser = new Parser(new Lexer(source));
  const ast = parser.parseExpression();
  const resolvedVars = normalizeVariableMap(variables);
  const result = evalNode(ast, resolvedVars);

  if (!Number.isFinite(result)) {
    throw new FormulaEvaluationError("Evaluation result is not finite");
  }
  return result;
}
