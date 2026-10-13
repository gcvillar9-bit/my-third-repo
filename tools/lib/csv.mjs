/** Minimal RFC 4180 CSV parsing (quoted fields, doubled quotes, CRLF). */

/** Splits one CSV line into fields. */
export function parseCsvLine(line, sep = ',') {
  const out = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    if (line[i] === '"') {
      let v = '';
      i++;
      while (i < n) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            v += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else v += line[i++];
      }
      out.push(v);
      while (i < n && line[i] !== sep) i++;
      i++;
    } else {
      let j = line.indexOf(sep, i);
      if (j < 0) j = n;
      out.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return out;
}

/**
 * Parses CSV text with a header row into objects keyed by column name (string values).
 * Assumes no newlines inside quoted fields (true for HYG / OpenNGC / OEC tables).
 */
export function parseCsv(text, sep = ',') {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0], sep);
  const rows = [];
  for (let k = 1; k < lines.length; k++) {
    const f = parseCsvLine(lines[k], sep);
    const row = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = f[c] ?? '';
    rows.push(row);
  }
  return { header, rows };
}
