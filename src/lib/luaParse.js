// Minimal parser for the subset of Lua that WoW's SavedVariables serializer emits,
// so the browser can read CrowLogsHelper.lua (the CrowLogsHelper addon's snapshot DB).
//
// Handles: top-level `NAME = value` assignments, nested tables `{ … }`, string keys
// `["k"] = v`, numeric keys `[19] = v`, bare positional entries (Lua array part),
// double-quoted strings (with escapes), numbers, true/false/nil, and `--`/`--[[ ]]`
// comments. Tables become plain objects keyed by their Lua key (integers stringified);
// positional entries get 1-based integer keys, matching Lua semantics — so a gear table
// indexes by equipment slot and `gear[13]`/`gear[14]` are the trinkets.

export function parseLua(text) {
  let i = 0
  const n = text.length

  function skipWs() {
    while (i < n) {
      const c = text[i]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        i++
        continue
      }
      if (c === '-' && text[i + 1] === '-') {
        i += 2
        if (text[i] === '[' && text[i + 1] === '[') {
          const end = text.indexOf(']]', i + 2)
          i = end === -1 ? n : end + 2
        } else {
          while (i < n && text[i] !== '\n') i++
        }
        continue
      }
      break
    }
  }

  function parseString() {
    i++ // opening quote
    let s = ''
    while (i < n) {
      const c = text[i++]
      if (c === '\\') {
        const e = text[i++]
        if (e === 'n') s += '\n'
        else if (e === 't') s += '\t'
        else if (e === 'r') s += '\r'
        else s += e // \", \\, and Lua's \ddd land here close enough for our data
      } else if (c === '"') break
      else s += c
    }
    return s
  }

  function parseNumber() {
    const start = i
    while (i < n && /[0-9.+\-eExXa-fA-F]/.test(text[i])) i++
    return Number(text.slice(start, i))
  }

  const isIdentStart = (c) => c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c === '_'
  const isIdent = (c) => isIdentStart(c) || c >= '0' && c <= '9'

  function parseValue() {
    skipWs()
    const c = text[i]
    if (c === '{') return parseTable()
    if (c === '"') return parseString()
    if (text.startsWith('true', i)) {
      i += 4
      return true
    }
    if (text.startsWith('false', i)) {
      i += 5
      return false
    }
    if (text.startsWith('nil', i)) {
      i += 3
      return null
    }
    return parseNumber()
  }

  function parseTable() {
    i++ // {
    const obj = {}
    let arrIdx = 1
    while (i < n) {
      skipWs()
      if (text[i] === '}') {
        i++
        break
      }
      let key = null
      if (text[i] === '[') {
        i++ // [
        skipWs()
        key = text[i] === '"' ? parseString() : parseNumber()
        skipWs()
        if (text[i] === ']') i++
        skipWs()
        if (text[i] === '=') i++
      } else if (isIdentStart(text[i])) {
        // `name = value` (bare identifier key) vs a keyword value (true/false/nil).
        let j = i
        while (j < n && isIdent(text[j])) j++
        let k = j
        while (k < n && (text[k] === ' ' || text[k] === '\t')) k++
        if (text[k] === '=' && text[k + 1] !== '=') {
          key = text.slice(i, j)
          i = k + 1
        }
      }
      const value = parseValue()
      if (key === null) obj[arrIdx++] = value
      else obj[key] = value
      skipWs()
      if (text[i] === ',' || text[i] === ';') i++
    }
    return obj
  }

  const result = {}
  skipWs()
  while (i < n) {
    skipWs()
    if (i >= n || !isIdentStart(text[i])) break
    let j = i
    while (j < n && isIdent(text[j])) j++
    const name = text.slice(i, j)
    i = j
    skipWs()
    if (text[i] !== '=') break
    i++
    result[name] = parseValue()
    skipWs()
  }
  return result
}

// Collect a Lua table's array part (contiguous integer keys from 1) into a JS array.
export function luaArray(tbl) {
  const out = []
  if (!tbl || typeof tbl !== 'object') return out
  for (let k = 1; tbl[k] !== undefined; k++) out.push(tbl[k])
  return out
}
