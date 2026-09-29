export function encodeCsv(rows: readonly (readonly (string | number)[])[]): string {
  return "\uFEFF" + rows.map((row) => row.map((value) => {
    const text = String(value)
    const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text
    return '"' + safe.replaceAll('"', '""') + '"'
  }).join(",")).join("\r\n")
}
