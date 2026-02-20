// Risky module — one vulnerability
import { exec } from "node:child_process";

export function deploy(branch: string) {
  exec(`git push origin ${branch}`);
}
