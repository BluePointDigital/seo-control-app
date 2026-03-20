import PDFDocument from 'pdfkit'

import { DEFAULT_REPORT_SECTION_IDS } from '../../shared/reportSections.js'

const PAGE = {
  width: 612,
  height: 792,
  marginX: 44,
  top: 42,
  bottom: 44,
}

const COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#dbe3ef',
  panel: '#ffffff',
  panelAlt: '#f8fafc',
  accent: '#0f766e',
  accentSoft: '#e6fffb',
  warning: '#b45309',
  warningSoft: '#fef3c7',
  danger: '#b91c1c',
  dangerSoft: '#fee2e2',
  link: '#1d4ed8',
}

const CORE_METRIC_ORDER = ['FCP', 'LCP', 'TBT', 'CLS', 'Speed Index', 'TTI']

export async function renderReportPdf({ report }) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: false,
    margin: 0,
    size: 'LETTER',
    info: {
      Title: getReportTitle(report),
      Author: 'Agency SEO Control',
      Subject: 'SEO report export',
      Creator: 'Agency SEO Control',
    },
  })

  const chunks = []
  doc.on('data', (chunk) => chunks.push(chunk))

  const state = createLayoutState(doc, report)
  addPage(state, { repeatHeader: false })
  drawHero(state)

  if (state.presentation) {
    renderPresentationReport(state)
  } else {
    renderFallbackReport(state)
  }

  stampBufferedFooters(doc, state)
  doc.end()

  return await new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

export function buildReportPdfFilename(report = {}) {
  const base = getReportTitle(report)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'seo-report'
  return `${base}.pdf`
}

function createLayoutState(doc, report) {
  const summary = report?.summary && typeof report.summary === 'object' ? report.summary : {}
  const presentation = summary?.presentation && typeof summary.presentation === 'object'
    ? summary.presentation
    : null
  const sectionsIncluded = normalizeSections(summary?.sectionsIncluded, presentation)
  return {
    doc,
    report,
    summary,
    presentation,
    sectionsIncluded,
    cursorY: PAGE.top,
    pageIndex: 0,
  }
}

function normalizeSections(sectionsIncluded = [], presentation = null) {
  if (Array.isArray(sectionsIncluded) && sectionsIncluded.length) {
    return DEFAULT_REPORT_SECTION_IDS.filter((sectionId) => sectionsIncluded.includes(sectionId))
  }

  if (!presentation || typeof presentation !== 'object') {
    return [...DEFAULT_REPORT_SECTION_IDS]
  }

  return DEFAULT_REPORT_SECTION_IDS.filter((sectionId) => {
    if (sectionId === 'executive') return Boolean(presentation.executive)
    if (sectionId === 'performance') return Array.isArray(presentation.charts) && presentation.charts.length > 0
    if (sectionId === 'ads') return Boolean(presentation.ads)
    if (sectionId === 'rankings') return Boolean(presentation.rankings)
    if (sectionId === 'lighthouse') return Boolean(presentation.lighthouse)
    if (sectionId === 'findings') return Boolean(presentation.groupedFindings)
    if (sectionId === 'actions') return Array.isArray(presentation.nextActions) && presentation.nextActions.length > 0
    return false
  })
}

function renderPresentationReport(state) {
  const orderedSections = [
    ['executive', () => drawExecutiveSection(state)],
    ['performance', () => drawPerformanceSection(state)],
    ['ads', () => drawAdsSection(state)],
    ['rankings', () => drawRankingsSection(state)],
    ['lighthouse', () => drawLighthouseSection(state)],
    ['findings', () => drawFindingsSection(state)],
    ['actions', () => drawActionsSection(state)],
  ]

  for (const [sectionId, render] of orderedSections) {
    if (!state.sectionsIncluded.includes(sectionId)) continue
    render()
  }
}

function renderFallbackReport(state) {
  const { report, summary } = state
  drawSectionHeading(state, {
    title: 'Saved report content',
    description: 'This export uses the saved markdown narrative because a structured presentation payload was not stored for this report run.',
  })

  const fallbackMetrics = [
    createMetric('Organic visibility', summary?.visibilityScore),
    createMetric('Map visibility', summary?.mapPackVisibilityScore),
    createMetric('Top 10 keywords', summary?.top10Count),
    createMetric('Top 3 pack', summary?.mapPackTop3Count),
    createMetric('Health score', summary?.healthScore),
  ].filter((metric) => metric.value != null)

  if (fallbackMetrics.length) {
    drawMetricGrid(state, fallbackMetrics, { columns: 3 })
    state.cursorY += 6
  }

  const blocks = String(report?.content || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  for (const block of blocks) {
    if (/^###\s+/.test(block)) {
      drawMiniHeading(state, block.replace(/^###\s+/, ''))
      continue
    }
    if (/^##\s+/.test(block)) {
      drawMiniHeading(state, block.replace(/^##\s+/, ''), { large: true })
      continue
    }
    if (/^#\s+/.test(block)) {
      drawMiniHeading(state, block.replace(/^#\s+/, ''), { large: true })
      continue
    }

    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.every((line) => line.startsWith('- '))) {
      for (const line of lines) {
        drawBulletLine(state, line.replace(/^- /, ''))
      }
      state.cursorY += 6
      continue
    }

    drawBodyText(state, lines.join(' '), { after: 10 })
  }
}

function drawHero(state) {
  const { doc, presentation, report, sectionsIncluded, summary } = state
  const title = getReportTitle(report)
  const dateRangeLabel = presentation?.meta?.dateRangeLabel || summary?.dateRangeLabel || buildDateRangeLabel(report)
  const headline = presentation?.meta?.headline || extractFallbackHeadline(report)
  const generatedAt = presentation?.meta?.generatedAt || report?.createdAt || new Date().toISOString()
  const x = PAGE.marginX
  const y = state.cursorY
  const width = PAGE.width - PAGE.marginX * 2
  const infoX = x + width - 188
  const infoWidth = 164
  const titleWidth = infoX - (x + 24) - 28
  const titleHeight = measureText(doc, title, {
    font: 'bold',
    size: 28,
    width: titleWidth,
    lineGap: 3,
  })
  const headlineY = y + 66 + titleHeight
  const headlineHeight = measureText(doc, headline, {
    font: 'regular',
    size: 11,
    width: titleWidth - 8,
    lineGap: 3,
  })
  const infoBottom = y + 150
  const leftBottom = headlineY + headlineHeight + 18
  const height = Math.max(164, infoBottom - y + 14, leftBottom - y + 12)

  drawRoundedPanel(doc, x, y, width, height, {
    fill: COLORS.panel,
    stroke: COLORS.line,
  })

  doc.save()
  doc.roundedRect(x + 18, y + 18, 164, 28, 14).fill(COLORS.accentSoft)
  doc.restore()
  setFont(doc, 'bold', 11)
  doc.fillColor(COLORS.accent).text('AGENCY SEO CONTROL', x + 30, y + 26, {
    width: 140,
    align: 'center',
  })

  setFont(doc, 'bold', 28)
  doc.fillColor(COLORS.ink).text(title, x + 24, y + 58, {
    width: titleWidth,
    lineGap: 3,
  })

  setFont(doc, 'regular', 11)
  doc.fillColor(COLORS.muted).text(headline, x + 24, headlineY + 8, {
    width: titleWidth - 8,
    lineGap: 3,
  })

  drawInfoCard(doc, infoX, y + 22, infoWidth, 42, 'Reporting window', dateRangeLabel)
  drawInfoCard(doc, infoX, y + 74, infoWidth, 42, 'Generated', formatDateTime(generatedAt))
  drawInfoCard(doc, infoX, y + 126, infoWidth, 24, 'Sections', String(sectionsIncluded.length || 0), { compact: true })

  state.cursorY += height + 18
}

function drawExecutiveSection(state) {
  const executive = state.presentation?.executive
  if (!executive) return

  drawSectionHeading(state, {
    title: 'Executive snapshot',
    description: 'Top-line client KPIs, rankings, and technical health for this report window.',
  })

  drawCallout(state, executive.headline)
  drawMetricGrid(state, executive.kpis || [], { columns: 3 })
}

function drawPerformanceSection(state) {
  const charts = Array.isArray(state.presentation?.charts) ? state.presentation.charts : []
  if (!charts.length) return

  drawSectionHeading(state, {
    title: 'Performance charts',
    description: 'Saved cross-channel trendlines rendered directly into the PDF as vector graphics.',
  })

  for (const chart of charts) {
    drawChartCard(state, chart)
  }
}

function drawAdsSection(state) {
  const ads = state.presentation?.ads
  if (!ads) return

  drawSectionHeading(state, {
    title: 'Google Ads / paid media',
    description: 'Paid reporting is kept separate so it only appears for clients where it is relevant.',
  })

  drawCallout(state, ads.narrative)
  drawMetricGrid(state, ads.kpis || [], { columns: 4 })

  for (const chart of ads.charts || []) {
    drawChartCard(state, chart, { compact: true })
  }
}

function drawRankingsSection(state) {
  const rankings = state.presentation?.rankings
  if (!rankings) return

  drawSectionHeading(state, {
    title: 'Rankings summary',
    description: 'Organic and map-pack movement, winners, decliners, and current matched local listings.',
  })

  const leftPanel = buildRankingPanel(rankings.organic, { showMatchedListings: false })
  const rightPanel = buildRankingPanel(rankings.mapPack, { showMatchedListings: true })
  drawSideBySidePanels(state, leftPanel, rightPanel)
}

function drawLighthouseSection(state) {
  const lighthouse = state.presentation?.lighthouse
  if (!lighthouse) return

  drawSectionHeading(state, {
    title: 'Lighthouse overview',
    description: 'Overview-only PageSpeed reporting with category scores, core metrics, and direct report links.',
  })

  if (lighthouse.error) {
    drawCallout(state, lighthouse.error, { tone: 'warning' })
  }

  const strategies = Array.isArray(lighthouse.strategies) ? lighthouse.strategies : []
  if (!strategies.length) {
    drawEmptyPanel(state, 'No Lighthouse overview data was stored with this report run.')
    return
  }

  for (const strategy of strategies) {
    drawLighthouseStrategyCard(state, strategy)
  }
}

function drawFindingsSection(state) {
  const findings = state.presentation?.groupedFindings
  if (!findings) return

  drawSectionHeading(state, {
    title: 'Grouped findings',
    description: 'Technical findings grouped by issue type, sorted by severity and issue volume, with every saved URL included.',
  })

  drawMetricGrid(state, [
    createMetric('High issues', findings.counts?.high || 0, { tone: 'danger' }),
    createMetric('Medium issues', findings.counts?.medium || 0, { tone: 'warning' }),
    createMetric('Low issues', findings.counts?.low || 0),
    createMetric('Finding groups', findings.totalGroups || 0, { tone: 'accent' }),
    createMetric('Affected URLs', findings.totalUrls || 0, { tone: 'subtle' }),
  ], { columns: 5 })

  if (!Array.isArray(findings.items) || !findings.items.length) {
    drawEmptyPanel(state, 'No grouped findings were saved with this report.')
    return
  }

  for (const item of findings.items) {
    drawFindingBlock(state, item)
  }
}

function drawActionsSection(state) {
  const actions = Array.isArray(state.presentation?.nextActions) ? state.presentation.nextActions : []
  if (!actions.length) return

  drawSectionHeading(state, {
    title: 'Recommended next actions',
    description: 'Priority actions inferred from trends, rankings movement, and technical findings.',
  })

  for (let index = 0; index < actions.length; index += 1) {
    drawActionRow(state, index + 1, actions[index])
  }
}

function drawSectionHeading(state, { title, description }) {
  const { doc } = state
  ensureSpace(state, 56)
  setFont(doc, 'bold', 18)
  doc.fillColor(COLORS.ink).text(title, PAGE.marginX, state.cursorY, {
    width: contentWidth(),
  })
  state.cursorY += 22
  if (description) {
    setFont(doc, 'regular', 10.5)
    doc.fillColor(COLORS.muted).text(description, PAGE.marginX, state.cursorY, {
      width: contentWidth(),
      lineGap: 2,
    })
    state.cursorY += doc.heightOfString(description, { width: contentWidth(), lineGap: 2 }) + 10
  } else {
    state.cursorY += 8
  }
}

function drawMetricGrid(state, metrics = [], { columns = 3 } = {}) {
  const items = Array.isArray(metrics) ? metrics.filter(Boolean) : []
  if (!items.length) return

  const gap = 12
  const width = (contentWidth() - gap * (columns - 1)) / columns
  const rowHeight = 74

  for (let index = 0; index < items.length; index += columns) {
    const row = items.slice(index, index + columns)
    ensureSpace(state, rowHeight + 4)
    const top = state.cursorY
    row.forEach((metric, offset) => {
      drawMetricCard(state.doc, PAGE.marginX + (width + gap) * offset, top, width, rowHeight, metric)
    })
    state.cursorY += rowHeight + gap
  }

  state.cursorY += 2
}

function drawChartCard(state, chart, { compact = false } = {}) {
  const height = compact ? 228 : 248
  ensureSpace(state, height + 4)
  const x = PAGE.marginX
  const y = state.cursorY
  const width = contentWidth()

  drawRoundedPanel(state.doc, x, y, width, height, {
    fill: COLORS.panel,
    stroke: COLORS.line,
  })

  setFont(state.doc, 'bold', 13)
  state.doc.fillColor(COLORS.ink).text(chart.title || 'Chart', x + 18, y + 16, {
    width: width - 36,
  })
  setFont(state.doc, 'regular', 9.5)
  state.doc.fillColor(COLORS.muted).text(chart.subtitle || '', x + 18, y + 34, {
    width: width - 36,
  })

  drawVectorChart(state.doc, {
    x: x + 18,
    y: y + 58,
    width: width - 36,
    height: compact ? 134 : 154,
    rows: chart.rows || [],
    series: chart.series || [],
  })

  drawChartLegend(state.doc, chart.series || [], x + 18, y + height - 26, width - 36)
  state.cursorY += height + 14
}

function buildRankingPanel(mode, { showMatchedListings = false } = {}) {
  if (!mode) return null
  const matchedListings = showMatchedListings ? mode.matchedListings || [] : []
  const movers = {
    winners: Array.isArray(mode.winners) ? mode.winners.slice(0, 5) : [],
    decliners: Array.isArray(mode.decliners) ? mode.decliners.slice(0, 5) : [],
  }

  const metrics = Array.isArray(mode.metrics) ? mode.metrics.slice(0, 4) : []
  return {
    title: mode.title || 'Rankings',
    narrative: mode.narrative || 'No movement saved for this report window.',
    latestDate: mode.latestDate || 'No baseline',
    metrics,
    winners: movers.winners,
    decliners: movers.decliners,
    matchedListings,
    minHeight: 314 + matchedListings.length * 15,
  }
}

function drawSideBySidePanels(state, leftPanel, rightPanel) {
  const panels = [leftPanel, rightPanel].filter(Boolean)
  if (!panels.length) return

  const gap = 14
  const width = (contentWidth() - gap) / 2
  const height = Math.max(...panels.map((panel) => panel.minHeight || 320))
  ensureSpace(state, height + 6)

  panels.forEach((panel, index) => {
    const x = PAGE.marginX + (width + gap) * index
    drawRankingPanelCard(state.doc, panel, x, state.cursorY, width, height)
  })

  state.cursorY += height + 16
}

function drawLighthouseStrategyCard(state, strategy) {
  const height = 292
  ensureSpace(state, height + 4)
  const x = PAGE.marginX
  const y = state.cursorY
  const width = contentWidth()

  drawRoundedPanel(state.doc, x, y, width, height, {
    fill: COLORS.panel,
    stroke: COLORS.line,
  })

  setFont(state.doc, 'bold', 13)
  state.doc.fillColor(COLORS.ink).text(`${strategy.label} report`, x + 18, y + 16, {
    width: width - 170,
  })

  if (strategy.reportUrl) {
    setFont(state.doc, 'bold', 9.5)
    state.doc.fillColor(COLORS.link).text('Open in PageSpeed', x + width - 128, y + 18, {
      width: 110,
      align: 'right',
      link: strategy.reportUrl,
      underline: true,
    })
  }

  const scoreMetrics = [
    createMetric('Performance', strategy.performance, { tone: scoreTone(strategy.performance) }),
    createMetric('SEO', strategy.seo, { tone: scoreTone(strategy.seo) }),
    createMetric('Accessibility', strategy.accessibility, { tone: scoreTone(strategy.accessibility) }),
    createMetric('Best practices', strategy.bestPractices, { tone: scoreTone(strategy.bestPractices) }),
  ]

  drawMetricRow(state.doc, x + 18, y + 46, width - 36, 58, scoreMetrics, { columns: 4 })

  const metrics = normalizeCoreMetrics(strategy.metrics || [])
  drawMetricGridWithinCard(state.doc, x + 18, y + 118, width - 36, metrics.map((metric) => ({
    label: metric.title,
    displayValue: metric.displayValue || 'n/a',
    tone: 'subtle',
  })), { columns: 3, rowHeight: 58 })

  state.cursorY += height + 14
}

function drawFindingBlock(state, item) {
  const x = PAGE.marginX
  const width = contentWidth()
  const metaLabel = `${String(item.code || 'unknown').toUpperCase()} - ${item.urlCount || 0} URLs`
  const metaWidth = 154
  const titleWidth = width - 96 - metaWidth - 28
  const titleHeight = measureText(state.doc, item.title || 'Finding', {
    font: 'bold',
    size: 13,
    width: titleWidth,
  })
  const metaHeight = measureText(state.doc, metaLabel, {
    font: 'bold',
    size: 8.5,
    width: metaWidth,
    lineGap: 1,
  })
  const messageHeight = measureText(state.doc, item.message || 'No description available.', {
    font: 'regular',
    size: 10,
    width: width - 36,
    lineGap: 2,
  })
  const headerHeight = Math.max(18, titleHeight, metaHeight)
  const urlHeights = (item.urls || []).map((url) => measureText(state.doc, url, {
    font: 'regular',
    size: 9.5,
    width: width - 74,
    lineGap: 1,
  }) + 4)
  const urlsHeight = urlHeights.reduce((sum, value) => sum + value, 0)
  const blockHeight = 68 + headerHeight + messageHeight + urlsHeight + 22
  ensureSpace(state, blockHeight)

  drawRoundedPanel(state.doc, x, state.cursorY, width, blockHeight, {
    fill: COLORS.panel,
    stroke: COLORS.line,
  })

  drawSeverityPill(state.doc, x + 18, state.cursorY + 16, item.severity)
  setFont(state.doc, 'bold', 13)
  state.doc.fillColor(COLORS.ink).text(item.title || 'Finding', x + 96, state.cursorY + 18, {
    width: titleWidth,
  })

  setFont(state.doc, 'bold', 8.5)
  state.doc.fillColor(COLORS.muted).text(metaLabel, x + width - metaWidth - 18, state.cursorY + 18, {
    width: metaWidth,
    align: 'right',
    lineGap: 1,
  })

  const messageY = state.cursorY + 24 + headerHeight
  setFont(state.doc, 'regular', 10)
  state.doc.fillColor(COLORS.muted).text(item.message || 'No description available.', x + 18, messageY, {
    width: width - 36,
    lineGap: 2,
  })

  state.doc.moveTo(x + 18, messageY + messageHeight + 10).lineTo(x + width - 18, messageY + messageHeight + 10).strokeColor('#e8eef7').lineWidth(1).stroke()
  state.cursorY = messageY + messageHeight + 18

  for (const url of item.urls || []) {
    ensureSpace(state, 18)
    drawLinkRow(state, url, {
      prefix: 'URL',
      x: PAGE.marginX + 18,
      width: width - 36,
    })
  }

  state.cursorY += 14
}

function drawActionRow(state, index, action) {
  ensureSpace(state, 56)
  const x = PAGE.marginX
  const y = state.cursorY
  const width = contentWidth()

  drawRoundedPanel(state.doc, x, y, width, 52, {
    fill: COLORS.panelAlt,
    stroke: COLORS.line,
  })

  state.doc.circle(x + 24, y + 26, 14).fill(COLORS.ink)
  setFont(state.doc, 'bold', 10)
  state.doc.fillColor('#ffffff').text(String(index), x + 20, y + 19, {
    width: 8,
    align: 'center',
  })

  setFont(state.doc, 'regular', 10.5)
  state.doc.fillColor(COLORS.ink).text(action, x + 48, y + 15, {
    width: width - 64,
    lineGap: 2,
  })

  state.cursorY += 64
}

function drawCallout(state, text, { tone = 'accent' } = {}) {
  const palette = tone === 'warning'
    ? { fill: COLORS.warningSoft, stroke: '#f59e0b', text: COLORS.warning }
    : { fill: COLORS.accentSoft, stroke: '#8ef0df', text: COLORS.ink }
  const height = Math.max(44, measureText(state.doc, text, {
    font: 'regular',
    size: 10.5,
    width: contentWidth() - 36,
    lineGap: 2,
  }) + 24)
  ensureSpace(state, height)
  drawRoundedPanel(state.doc, PAGE.marginX, state.cursorY, contentWidth(), height, palette)
  setFont(state.doc, 'regular', 10.5)
  state.doc.fillColor(palette.text).text(text, PAGE.marginX + 18, state.cursorY + 12, {
    width: contentWidth() - 36,
    lineGap: 2,
  })
  state.cursorY += height + 14
}

function drawEmptyPanel(state, text) {
  ensureSpace(state, 64)
  drawRoundedPanel(state.doc, PAGE.marginX, state.cursorY, contentWidth(), 60, {
    fill: COLORS.panelAlt,
    stroke: COLORS.line,
  })
  setFont(state.doc, 'regular', 10.5)
  state.doc.fillColor(COLORS.muted).text(text, PAGE.marginX + 18, state.cursorY + 20, {
    width: contentWidth() - 36,
    align: 'center',
  })
  state.cursorY += 72
}

function drawMiniHeading(state, text, { large = false } = {}) {
  ensureSpace(state, large ? 30 : 24)
  setFont(state.doc, 'bold', large ? 15 : 12)
  state.doc.fillColor(COLORS.ink).text(text, PAGE.marginX, state.cursorY, {
    width: contentWidth(),
  })
  state.cursorY += large ? 24 : 18
}

function drawBodyText(state, text, { after = 0 } = {}) {
  const height = measureText(state.doc, text, {
    font: 'regular',
    size: 10.5,
    width: contentWidth(),
    lineGap: 2,
  })
  ensureSpace(state, height + after)
  setFont(state.doc, 'regular', 10.5)
  state.doc.fillColor(COLORS.ink).text(text, PAGE.marginX, state.cursorY, {
    width: contentWidth(),
    lineGap: 2,
  })
  state.cursorY += height + after
}

function drawBulletLine(state, text) {
  const bulletX = PAGE.marginX + 2
  const textX = PAGE.marginX + 14
  const width = contentWidth() - 14
  const height = measureText(state.doc, text, {
    font: 'regular',
    size: 10.5,
    width,
    lineGap: 2,
  })
  ensureSpace(state, height + 3)
  state.doc.circle(bulletX + 3, state.cursorY + 7, 2.2).fill(COLORS.accent)
  setFont(state.doc, 'regular', 10.5)
  state.doc.fillColor(COLORS.ink).text(text, textX, state.cursorY, {
    width,
    lineGap: 2,
  })
  state.cursorY += height + 4
}

function drawLinkRow(state, url, { prefix = '', x = PAGE.marginX, width = contentWidth() } = {}) {
  const prefixWidth = prefix ? 30 : 0
  if (prefix) {
    setFont(state.doc, 'bold', 9.5)
    state.doc.fillColor(COLORS.muted).text(prefix, x, state.cursorY, {
      width: prefixWidth,
    })
  }
  setFont(state.doc, 'regular', 9.5)
  state.doc.fillColor(COLORS.link).text(url, x + prefixWidth + (prefix ? 8 : 0), state.cursorY, {
    width: width - prefixWidth - (prefix ? 8 : 0),
    link: url,
    underline: true,
  })
  state.cursorY += measureText(state.doc, url, {
    font: 'regular',
    size: 9.5,
    width: width - prefixWidth - (prefix ? 8 : 0),
  }) + 4
}

function drawRankingPanelCard(doc, panel, x, y, width, height) {
  drawRoundedPanel(doc, x, y, width, height, {
    fill: COLORS.panel,
    stroke: COLORS.line,
  })

  setFont(doc, 'bold', 13)
  doc.fillColor(COLORS.ink).text(panel.title, x + 16, y + 16, {
    width: width - 104,
  })
  setFont(doc, 'bold', 9.5)
  doc.fillColor(COLORS.muted).text(panel.latestDate || 'No baseline', x + width - 90, y + 18, {
    width: 72,
    align: 'right',
  })

  setFont(doc, 'regular', 9.5)
  doc.fillColor(COLORS.muted).text(panel.narrative, x + 16, y + 36, {
    width: width - 32,
    lineGap: 2,
  })

  drawMetricRow(doc, x + 16, y + 82, width - 32, 56, panel.metrics || [], { columns: 2 })

  let cursor = y + 150
  cursor = drawMovementList(doc, x + 16, cursor, width - 32, 'Winners', panel.winners, 'up')
  cursor = drawMovementList(doc, x + 16, cursor + 8, width - 32, 'Decliners', panel.decliners, 'down')

  if (panel.matchedListings?.length) {
    setFont(doc, 'bold', 10)
    doc.fillColor(COLORS.ink).text('Matched listings', x + 16, cursor + 10, {
      width: width - 32,
    })
    cursor += 26
    panel.matchedListings.slice(0, 8).forEach((item) => {
      setFont(doc, 'regular', 9)
      doc.fillColor(COLORS.ink).text(`#${item.position || 'n/a'} ${item.keyword || 'Keyword'}`, x + 16, cursor, {
        width: width - 32,
      })
      cursor += 12
      if (item.foundName) {
        doc.fillColor(COLORS.muted).text(item.foundName, x + 26, cursor, {
          width: width - 42,
        })
        cursor += 11
      }
    })
  }
}

function drawMovementList(doc, x, y, width, title, items = [], direction = 'up') {
  setFont(doc, 'bold', 10)
  doc.fillColor(COLORS.ink).text(title, x, y, { width })
  let cursor = y + 16
  if (!items.length) {
    setFont(doc, 'regular', 9)
    doc.fillColor(COLORS.muted).text(`No ${title.toLowerCase()} saved for this report.`, x, cursor, { width })
    return cursor + 16
  }

  items.slice(0, 5).forEach((item) => {
    const delta = Number(item?.delta || item?.change || 0)
    const prefix = direction === 'down' ? '-' : '+'
    const deltaLabel = Number.isFinite(delta) && delta > 0 ? `${prefix}${delta}` : 'n/a'
    setFont(doc, 'regular', 9)
    doc.fillColor(COLORS.ink).text(`${item.keyword || 'Keyword'} (${deltaLabel})`, x, cursor, {
      width,
    })
    cursor += 12
  })
  return cursor
}

function drawMetricCard(doc, x, y, width, height, metric) {
  const tone = metricCardTone(metric?.tone)
  drawRoundedPanel(doc, x, y, width, height, tone)
  setFont(doc, 'bold', 9)
  doc.fillColor(COLORS.muted).text(String(metric?.label || 'Metric').toUpperCase(), x + 14, y + 14, {
    width: width - 28,
  })
  setFont(doc, 'bold', 18)
  doc.fillColor(COLORS.ink).text(formatMetricValue(metric), x + 14, y + 34, {
    width: width - 28,
  })
}

function drawMetricRow(doc, x, y, width, height, metrics = [], { columns = 4 } = {}) {
  const gap = 10
  const cellWidth = (width - gap * (columns - 1)) / columns
  metrics.slice(0, columns).forEach((metric, index) => {
    drawMetricCard(doc, x + (cellWidth + gap) * index, y, cellWidth, height, metric)
  })
}

function drawMetricGridWithinCard(doc, x, y, width, metrics = [], { columns = 3, rowHeight = 56 } = {}) {
  const gap = 10
  const cellWidth = (width - gap * (columns - 1)) / columns

  for (let index = 0; index < metrics.length; index += columns) {
    const row = metrics.slice(index, index + columns)
    const rowY = y + Math.floor(index / columns) * (rowHeight + gap)
    row.forEach((metric, offset) => {
      drawMetricCard(doc, x + (cellWidth + gap) * offset, rowY, cellWidth, rowHeight, metric)
    })
  }
}

function drawVectorChart(doc, { x, y, width, height, rows, series }) {
  drawRoundedPanel(doc, x, y, width, height, {
    fill: '#ffffff',
    stroke: COLORS.line,
  })

  if (!Array.isArray(rows) || !rows.length || !Array.isArray(series) || !series.length) {
    setFont(doc, 'regular', 10)
    doc.fillColor(COLORS.muted).text('No saved trend data for this chart.', x + 18, y + height / 2 - 6, {
      width: width - 36,
      align: 'center',
    })
    return
  }

  const values = rows.flatMap((row) => (
    series.map((item) => Number(row?.[item.key] ?? NaN)).filter((value) => Number.isFinite(value))
  ))
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const floor = min === max ? 0 : min
  const ceil = min === max ? max || 1 : max
  const plotX = x + 18
  const plotY = y + 16
  const plotWidth = width - 36
  const plotHeight = height - 46

  doc.save()
  for (let index = 0; index <= 4; index += 1) {
    const lineY = plotY + (plotHeight / 4) * index
    doc.moveTo(plotX, lineY).lineTo(plotX + plotWidth, lineY).strokeColor('#e8eef7').lineWidth(1).stroke()
  }
  doc.restore()

  const steps = Math.max(rows.length - 1, 1)
  series.forEach((item) => {
    const points = rows
      .map((row, index) => {
        const value = Number(row?.[item.key] ?? NaN)
        if (!Number.isFinite(value)) return null
        const progress = index / steps
        const normalized = ceil === floor ? 0.5 : (value - floor) / (ceil - floor || 1)
        return {
          x: plotX + plotWidth * progress,
          y: plotY + plotHeight - normalized * plotHeight,
        }
      })
      .filter(Boolean)

    if (!points.length) return

    doc.save()
    doc.lineWidth(2)
    doc.strokeColor(item.color || COLORS.accent)
    doc.moveTo(points[0].x, points[0].y)
    for (let index = 1; index < points.length; index += 1) {
      doc.lineTo(points[index].x, points[index].y)
    }
    doc.stroke()

    points.forEach((point) => {
      doc.circle(point.x, point.y, 2.4).fill(item.color || COLORS.accent)
    })
    doc.restore()
  })

  const firstDate = rows[0]?.date ? formatCompactDate(rows[0].date) : ''
  const lastDate = rows[rows.length - 1]?.date ? formatCompactDate(rows[rows.length - 1].date) : ''
  setFont(doc, 'regular', 8.5)
  doc.fillColor(COLORS.muted).text(firstDate, plotX, y + height - 20, {
    width: 70,
  })
  doc.fillColor(COLORS.muted).text(lastDate, plotX + plotWidth - 70, y + height - 20, {
    width: 70,
    align: 'right',
  })
}

function drawChartLegend(doc, series = [], x, y, width) {
  let cursor = x
  series.forEach((item) => {
    doc.circle(cursor + 4, y + 4, 3.5).fill(item.color || COLORS.accent)
    setFont(doc, 'regular', 8.5)
    doc.fillColor(COLORS.muted).text(item.label || item.key || 'Series', cursor + 12, y - 2, {
      width: Math.min(110, width - (cursor - x)),
    })
    cursor += 96
  })
}

function drawInfoCard(doc, x, y, width, height, label, value, { compact = false } = {}) {
  drawRoundedPanel(doc, x, y, width, height, {
    fill: COLORS.panelAlt,
    stroke: COLORS.line,
  })
  setFont(doc, 'bold', 8.5)
  doc.fillColor(COLORS.muted).text(String(label || '').toUpperCase(), x + 12, y + (compact ? 6 : 8), {
    width: width - 24,
  })
  setFont(doc, 'bold', compact ? 11 : 10)
  doc.fillColor(COLORS.ink).text(value || 'n/a', x + 12, y + (compact ? 15 : 20), {
    width: width - 24,
  })
}

function drawRoundedPanel(doc, x, y, width, height, colors = {}) {
  doc.save()
  doc.roundedRect(x, y, width, height, 16)
  doc.fillAndStroke(colors.fill || COLORS.panel, colors.stroke || COLORS.line)
  doc.restore()
}

function drawSeverityPill(doc, x, y, severity) {
  const normalized = String(severity || 'low').toLowerCase()
  const palette = normalized === 'high'
    ? { fill: COLORS.dangerSoft, text: COLORS.danger, width: 64 }
    : normalized === 'medium'
      ? { fill: COLORS.warningSoft, text: COLORS.warning, width: 74 }
      : { fill: '#e2e8f0', text: COLORS.ink, width: 56 }
  doc.save()
  doc.roundedRect(x, y, palette.width, 18, 9).fill(palette.fill)
  doc.restore()
  setFont(doc, 'bold', 8.5)
  doc.fillColor(palette.text).text(normalized.toUpperCase(), x, y + 5, {
    width: palette.width,
    align: 'center',
  })
}

function addPage(state, { repeatHeader = true } = {}) {
  state.doc.addPage()
  state.pageIndex += 1
  state.cursorY = PAGE.top

  if (repeatHeader) {
    drawRepeatingPageHeader(state)
  }
}

function ensureSpace(state, minHeight) {
  const availableBottom = PAGE.height - PAGE.bottom
  if (state.cursorY + minHeight <= availableBottom) return
  addPage(state)
}

function drawRepeatingPageHeader(state) {
  const { doc, presentation, report } = state
  const title = presentation?.meta?.title || getReportTitle(report)
  const range = presentation?.meta?.dateRangeLabel || buildDateRangeLabel(report)

  setFont(doc, 'bold', 9)
  doc.fillColor(COLORS.accent).text('AGENCY SEO CONTROL', PAGE.marginX, 24, {
    width: 140,
  })
  setFont(doc, 'bold', 12)
  doc.fillColor(COLORS.ink).text(title, PAGE.marginX, 38, {
    width: contentWidth() - 140,
  })
  setFont(doc, 'regular', 9)
  doc.fillColor(COLORS.muted).text(range, PAGE.width - PAGE.marginX - 120, 38, {
    width: 120,
    align: 'right',
  })
  doc.moveTo(PAGE.marginX, 58).lineTo(PAGE.width - PAGE.marginX, 58).strokeColor(COLORS.line).lineWidth(1).stroke()
  state.cursorY = 72
}

function stampBufferedFooters(doc, state) {
  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index)
    const pageNumber = index + 1
    const totalPages = range.count
    const title = state.presentation?.meta?.workspaceName || state.report?.summary?.workspaceName || 'SEO report'
    doc.moveTo(PAGE.marginX, PAGE.height - 30).lineTo(PAGE.width - PAGE.marginX, PAGE.height - 30).strokeColor(COLORS.line).lineWidth(1).stroke()
    setFont(doc, 'regular', 8.5)
    doc.fillColor(COLORS.muted).text(title, PAGE.marginX, PAGE.height - 24, {
      width: 180,
    })
    doc.text(`Page ${pageNumber} of ${totalPages}`, PAGE.width - PAGE.marginX - 80, PAGE.height - 24, {
      width: 80,
      align: 'right',
    })
  }
}

function contentWidth() {
  return PAGE.width - PAGE.marginX * 2
}

function setFont(doc, family, size) {
  const fontName = family === 'bold' ? 'Helvetica-Bold' : family === 'italic' ? 'Helvetica-Oblique' : 'Helvetica'
  doc.font(fontName).fontSize(size)
}

function measureText(doc, text, { font = 'regular', size = 10, width = contentWidth(), lineGap = 0 } = {}) {
  setFont(doc, font, size)
  return doc.heightOfString(String(text || ''), { width, lineGap })
}

function formatMetricValue(metric) {
  if (metric?.displayValue) return String(metric.displayValue)
  if (metric?.value == null) return 'n/a'
  return String(metric.value)
}

function metricCardTone(tone = 'default') {
  if (tone === 'accent') return { fill: COLORS.accentSoft, stroke: '#94f0e1' }
  if (tone === 'warning') return { fill: COLORS.warningSoft, stroke: '#f5c16b' }
  if (tone === 'danger') return { fill: COLORS.dangerSoft, stroke: '#f3a6a6' }
  if (tone === 'subtle') return { fill: COLORS.panelAlt, stroke: COLORS.line }
  return { fill: COLORS.panel, stroke: COLORS.line }
}

function scoreTone(score) {
  const numeric = Number(score)
  if (!Number.isFinite(numeric)) return 'default'
  if (numeric >= 90) return 'accent'
  if (numeric >= 50) return 'warning'
  return 'danger'
}

function normalizeCoreMetrics(metrics = []) {
  const byTitle = new Map((Array.isArray(metrics) ? metrics : []).map((metric) => [metric.title, metric]))
  return CORE_METRIC_ORDER.map((title) => ({
    title,
    displayValue: byTitle.get(title)?.displayValue || 'n/a',
  }))
}

function getReportTitle(report = {}) {
  return report?.summary?.presentation?.meta?.title
    || `${report?.summary?.workspaceName || report?.workspaceName || 'Workspace'} SEO Report`
}

function buildDateRangeLabel(report = {}) {
  const start = report?.periodStart || report?.summary?.periodStart || ''
  const end = report?.periodEnd || report?.summary?.periodEnd || ''
  if (start && end) return `${start} to ${end}`
  return report?.summary?.dateRangeLabel || 'Saved report window'
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'n/a'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatCompactDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '')
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function extractFallbackHeadline(report = {}) {
  const lines = String(report?.content || '').split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.find((line) => !line.startsWith('#') && !line.startsWith('Generated:') && !line.startsWith('Period:'))
    || 'Saved report export generated from the most recent structured SEO summary available for this report run.'
}

function createMetric(label, value, options = {}) {
  const numeric = Number(value)
  return {
    label,
    value: Number.isFinite(numeric) ? numeric : null,
    displayValue: options.displayValue || (Number.isFinite(numeric) ? String(numeric) : 'n/a'),
    tone: options.tone || 'default',
  }
}
