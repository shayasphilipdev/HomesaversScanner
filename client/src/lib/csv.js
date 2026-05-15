// Minimal CSV parser. Handles quoted fields, escaped quotes ("" → "),
// embedded newlines inside quotes, and a leading UTF-8 BOM.
// Returns { headers: string[], rows: object[] }.
export function parseCSV(text) {
  if (!text) return { headers: [], rows: [] }
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

  const records = []
  let field = '', record = [], inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { record.push(field); field = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { record.push(field); records.push(record); field = ''; record = [] }
      else field += c
    }
  }
  if (field !== '' || record.length) { record.push(field); records.push(record) }

  if (!records.length) return { headers: [], rows: [] }
  const headers = records[0].map(h => h.trim())
  const rows = records.slice(1)
    .filter(r => r.some(c => c.trim() !== ''))
    .map(r => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] || '').trim()])))
  return { headers, rows }
}
