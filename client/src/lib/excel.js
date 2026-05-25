// Lazy-loads SheetJS and triggers an .xlsx download.
// cols    — array of object keys to extract from each row
// headers — array of column header strings (same order as cols)
// rows    — array of plain objects
// linkCols — optional Set of col keys whose values should become hyperlinks

export async function downloadExcel(filename, rows, cols, headers, linkCols) {
  const XLSX = await import('xlsx')
  const utils = XLSX.utils

  // Build header row + data rows as array-of-arrays
  const aoa = [
    headers,
    ...rows.map(r =>
      cols.map(c => {
        const v = r[c]
        return v == null ? '' : v
      })
    )
  ]

  const ws = utils.aoa_to_sheet(aoa)

  // Hyperlinks: SheetJS stores links on individual cell objects.
  // We iterate data rows and patch any link-column cells.
  if (linkCols && linkCols.size) {
    rows.forEach((r, ri) => {
      cols.forEach((c, ci) => {
        if (!linkCols.has(c)) return
        const url = String(r[c] || '').trim()
        if (!url) return
        const cellAddr = utils.encode_cell({ r: ri + 1, c: ci })  // +1 for header row
        if (!ws[cellAddr]) return
        ws[cellAddr].l = { Target: url }
        ws[cellAddr].v = 'View'
      })
    })
  }

  // Auto-width: each column as wide as its longest value (capped at 60)
  const colWidths = headers.map((h, ci) => {
    const max = Math.max(
      String(h).length,
      ...rows.map(r => String(cols[ci] in r && r[cols[ci]] != null ? r[cols[ci]] : '').length)
    )
    return { wch: Math.min(max + 2, 60) }
  })
  ws['!cols'] = colWidths

  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, 'Report')
  XLSX.writeFile(wb, filename.replace(/\.csv$/i, '.xlsx'))
}
