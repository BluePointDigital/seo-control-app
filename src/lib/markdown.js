export function escapeHtml(value = '') {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function markdownToHtml(markdown = '') {
  const lines = String(markdown || '').split('\n')
  const output = []
  let listItems = []

  const flushList = () => {
    if (!listItems.length) return
    output.push(`<ul>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`)
    listItems = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      flushList()
      continue
    }

    if (line.startsWith('- ')) {
      listItems.push(line.slice(2))
      continue
    }

    flushList()

    if (line.startsWith('### ')) {
      output.push(`<h3>${escapeHtml(line.slice(4))}</h3>`)
      continue
    }
    if (line.startsWith('## ')) {
      output.push(`<h2>${escapeHtml(line.slice(3))}</h2>`)
      continue
    }
    if (line.startsWith('# ')) {
      output.push(`<h1>${escapeHtml(line.slice(2))}</h1>`)
      continue
    }

    output.push(`<p>${escapeHtml(line)}</p>`)
  }

  flushList()
  return output.join('\n')
}

export function markdownToBlocks(markdown = '') {
  const lines = String(markdown || '').split('\n')
  const blocks = []
  let listItems = []

  const flushList = () => {
    if (!listItems.length) return
    blocks.push({ type: 'list', items: listItems })
    listItems = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      flushList()
      continue
    }

    if (line.startsWith('- ')) {
      listItems.push(line.slice(2))
      continue
    }

    flushList()

    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4) })
      continue
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3) })
      continue
    }
    if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', text: line.slice(2) })
      continue
    }

    blocks.push({ type: 'p', text: line })
  }

  flushList()
  return blocks
}
