/**
 * Lightweight markdown-to-HTML renderer for the Skill Builder preview.
 * Returns an HTML string for use with dangerouslySetInnerHTML.
 *
 * Handles: headers, bold, italic, inline code, fenced code blocks,
 * unordered/ordered lists, links, and pipe-separated tables.
 */
export function renderMarkdown(text: string): string {
  if (!text) return "";

  // First, extract and render tables (multi-line constructs)
  let result = renderTables(text);

  // Code blocks (``` ... ```) — must run before inline transforms
  result = result.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre style="background:var(--surface-2);padding:0.75rem;border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.5;margin:0.5rem 0;border:1px solid var(--border-subtle)"><code>$2</code></pre>',
  );

  // Headers (must run before bold to avoid conflict with **)
  result = result.replace(
    /^### (.+)$/gm,
    '<div style="font-weight:600;font-size:14px;margin:0.75rem 0 0.25rem;color:var(--text-primary)">$1</div>',
  );
  result = result.replace(
    /^## (.+)$/gm,
    '<div style="font-weight:700;font-size:15px;margin:0.75rem 0 0.25rem;color:var(--text-primary)">$1</div>',
  );
  result = result.replace(
    /^# (.+)$/gm,
    '<div style="font-weight:700;font-size:1rem;margin:0.75rem 0 0.25rem;color:var(--text-primary)">$1</div>',
  );

  // Links — before bold/italic to avoid conflicts
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline">$1</a>',
  );

  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Inline code
  result = result.replace(
    /`([^`]+)`/g,
    '<code style="background:var(--surface-3);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.85em">$1</code>',
  );

  // Unordered lists
  result = result.replace(
    /^- (.+)$/gm,
    '<div style="padding-left:1rem;margin:0.15rem 0">\u2022 $1</div>',
  );

  // Ordered lists
  result = result.replace(
    /^(\d+)\. (.+)$/gm,
    '<div style="padding-left:1rem;margin:0.15rem 0">$1. $2</div>',
  );

  // Double newlines → spacing
  result = result.replace(/\n\n/g, '<div style="height:0.5rem"></div>');

  // Single newlines → line break
  result = result.replace(/\n/g, "<br/>");

  return result;
}

/**
 * Detect and render pipe-separated markdown tables.
 * A table requires: header row, separator row (containing ---), and 1+ data rows.
 */
function renderTables(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Check if this line could be a table header (starts with |)
    if (
      lines[i].trim().startsWith("|") &&
      i + 1 < lines.length &&
      lines[i + 1].trim().startsWith("|") &&
      /\|[\s-:]+\|/.test(lines[i + 1])
    ) {
      // Found header + separator — collect the table
      const headerCells = parsePipeRow(lines[i]);
      i += 2; // skip header + separator

      const dataRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        dataRows.push(parsePipeRow(lines[i]));
        i++;
      }

      // Build HTML table
      const thStyle = 'style="text-align:left;padding:0.4rem 0.6rem;font-weight:600;font-size:12px;color:var(--text-primary);border-bottom:1px solid var(--border-default)"';
      const tdStyle = 'style="padding:0.4rem 0.6rem;font-size:12px;color:var(--text-secondary);border-bottom:1px solid var(--border-subtle)"';

      let html = '<table style="width:100%;border-collapse:collapse;margin:0.5rem 0;border:1px solid var(--border-subtle);border-radius:6px;overflow:hidden">';
      html += "<thead><tr>";
      for (const cell of headerCells) {
        html += `<th ${thStyle}>${cell}</th>`;
      }
      html += "</tr></thead><tbody>";
      for (const row of dataRows) {
        html += "<tr>";
        for (const cell of row) {
          html += `<td ${tdStyle}>${cell}</td>`;
        }
        html += "</tr>";
      }
      html += "</tbody></table>";
      output.push(html);
    } else {
      output.push(lines[i]);
      i++;
    }
  }

  return output.join("\n");
}

function parsePipeRow(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}
