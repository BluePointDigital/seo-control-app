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

export function LineChart({ rows = [], series = [], height = 230 }) {
  if (!rows.length || !series.length) return <div className="spark-empty">No chart data yet.</div>

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
    <div className="line-chart" style={{ height }}>
      <Line data={data} options={options} />
    </div>
  )
}
