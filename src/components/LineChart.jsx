import {
  Chart as ChartJS,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

export function LineChart({ rows = [], series = [], height = 230, staticMode = false }) {
  if (!rows.length || !series.length) {
    return (
      <div className="flex h-[230px] items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50/80 text-sm text-slate-500">
        No chart data yet.
      </div>
    )
  }

  if (staticMode) {
    return <StaticLineChart height={height} rows={rows} series={series} />
  }

  const data = {
    labels: rows.map((row) => String(row.date || '').slice(5)),
    datasets: series.map((item) => ({
      label: item.label || item.key,
      data: rows.map((row) => (row[item.key] === null || row[item.key] === undefined ? null : Number(row[item.key] || 0))),
      borderColor: item.color,
      backgroundColor: item.color,
      borderWidth: 2,
      borderDash: item.dashed ? [6, 4] : undefined,
      pointRadius: item.dashed ? 0 : 1.5,
      tension: 0.25,
      spanGaps: true,
    })),
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: {
        grid: { color: '#edf2f7' },
        ticks: { color: '#6b7280', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
      },
      y: {
        grid: { color: '#edf2f7' },
        ticks: { color: '#6b7280' },
      },
    },
  }

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/80 p-3 shadow-sm" style={{ height }}>
      <Line data={data} options={options} />
    </div>
  )
}

function StaticLineChart({ height = 230, rows = [], series = [] }) {
  const width = 960
  const svgHeight = Math.max(220, Number(height || 230))
  const padding = { top: 18, right: 20, bottom: 34, left: 42 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = svgHeight - padding.top - padding.bottom
  const values = series.flatMap((item) => rows.map((row) => {
    const value = row[item.key]
    return value === null || value === undefined ? null : Number(value)
  })).filter((value) => Number.isFinite(value))
  const minValue = values.length ? Math.min(...values, 0) : 0
  const maxValue = values.length ? Math.max(...values, 1) : 1
  const range = maxValue - minValue || 1
  const tickCount = 4
  const labelIndexes = Array.from(new Set([
    0,
    Math.floor((rows.length - 1) * 0.25),
    Math.floor((rows.length - 1) * 0.5),
    Math.floor((rows.length - 1) * 0.75),
    rows.length - 1,
  ].filter((index) => index >= 0)))

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white/95 p-3 shadow-sm">
      <svg viewBox={`0 0 ${width} ${svgHeight}`} className="h-full w-full" role="img" aria-label="Report trend chart">
        <rect x="0" y="0" width={width} height={svgHeight} rx="24" fill="white" />

        {Array.from({ length: tickCount + 1 }, (_, index) => {
          const ratio = index / tickCount
          const y = padding.top + plotHeight - ratio * plotHeight
          const value = minValue + ratio * range
          return (
            <g key={`grid-${index}`}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padding.left - 10} y={y + 4} fill="#64748b" fontSize="11" textAnchor="end">
                {formatAxisValue(value)}
              </text>
            </g>
          )
        })}

        {series.map((item) => {
          const points = rows.map((row, index) => {
            const raw = row[item.key]
            if (raw === null || raw === undefined || Number.isNaN(Number(raw))) return null
            const x = rows.length === 1
              ? padding.left + plotWidth / 2
              : padding.left + (index / (rows.length - 1)) * plotWidth
            const y = padding.top + plotHeight - ((Number(raw) - minValue) / range) * plotHeight
            return { x, y }
          })

          return (
            <g key={item.key}>
              <path
                d={buildPath(points)}
                fill="none"
                stroke={item.color}
                strokeDasharray={item.dashed ? '8 5' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
              />
              {points.filter(Boolean).map((point, pointIndex) => (
                <circle key={`${item.key}-${pointIndex}`} cx={point.x} cy={point.y} fill={item.color} r="3.25" />
              ))}
            </g>
          )
        })}

        {labelIndexes.map((index) => {
          const x = rows.length === 1
            ? padding.left + plotWidth / 2
            : padding.left + (index / (rows.length - 1)) * plotWidth
          return (
            <text key={`label-${index}`} x={x} y={svgHeight - 10} fill="#64748b" fontSize="11" textAnchor="middle">
              {String(rows[index]?.date || '').slice(5)}
            </text>
          )
        })}
      </svg>
      <div className="mt-3 flex flex-wrap gap-3 px-1">
        {series.map((item) => (
          <div key={`legend-${item.key}`} className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span>{item.label || item.key}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildPath(points = []) {
  const filtered = points.filter(Boolean)
  if (!filtered.length) return ''

  return filtered.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function formatAxisValue(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '0'
  if (Math.abs(numeric) >= 1000) return Math.round(numeric).toLocaleString()
  if (Math.abs(numeric) >= 100) return Math.round(numeric).toString()
  if (Math.abs(numeric) >= 10) return numeric.toFixed(1)
  return numeric.toFixed(2)
}
