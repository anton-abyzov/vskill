// Vulnerable handler — multiple security issues
import { exec } from "node:child_process";

// CI-001: Command injection via exec
export function runCommand(userInput: string) {
  exec(`ls ${userInput}`);
}

// CE-001: Code execution via eval
export function evaluate(code: string) {
  return eval(code);
}

// XSS-001: innerHTML assignment
export function renderHtml(el: HTMLElement, content: string) {
  el.innerHTML = content;
}

// HS-001: Hardcoded API key
const API_KEY = "sk-1234567890abcdef1234567890abcdef";

// SQLI-001: SQL injection via concatenation
export function getUser(db: any, userId: string) {
  return db.query("SELECT * FROM users WHERE id = '" + userId + "'");
}
