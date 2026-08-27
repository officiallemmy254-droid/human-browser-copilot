// Human Browser Host - Security Policy & Audit Trail Logger
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

const LOG_DIR = path.join(os.homedir(), ".human-browser");
const AUDIT_FILE = path.join(LOG_DIR, "audit.log");

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function logAuditEvent(action: string, params: any, result: any, isApproved: boolean = true) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    params,
    result,
    isApproved
  };

  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(AUDIT_FILE, line, "utf8");
}

/**
 * Prompts user in CLI terminal for high-risk action confirmation if needed
 */
export function promptTerminalApproval(action: string, reason: string, details: any): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr // Use stderr to avoid polluting MCP stdio
    });

    process.stderr.write(`\n=======================================================\n`);
    process.stderr.write(`🛡️  HUMAN BROWSER APPROVAL REQUIRED\n`);
    process.stderr.write(`Action: ${action}\n`);
    process.stderr.write(`Reason: ${reason}\n`);
    process.stderr.write(`Details: ${JSON.stringify(details, null, 2)}\n`);
    process.stderr.write(`=======================================================\n`);

    rl.question(`Approve execution? [y/N]: `, (answer) => {
      rl.close();
      const approved = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
      resolve(approved);
    });
  });
}
