#!/usr/bin/env node

/**
 * vskill CLI — Secure multi-platform AI skill installer
 *
 * Commands:
 *   add <owner/repo>     Install a skill with security scanning
 *   scan <path>          Scan a skill for security issues
 *   list [--agents]      List installed skills or detected agents
 *   compare <skill>      Compare skill across sources
 *   update [skill]       Update installed skills with diff scan
 *   submit <owner/repo>  Submit a skill for verification
 */

const command = process.argv[2];

switch (command) {
  case 'add':
  case 'scan':
  case 'list':
  case 'compare':
  case 'update':
  case 'submit':
    console.log(`vskill ${command}: not yet implemented`);
    break;
  default:
    console.log('Usage: vskill <add|scan|list|compare|update|submit>');
    process.exit(1);
}
