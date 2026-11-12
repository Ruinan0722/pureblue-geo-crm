/** SVG 徽章 — html2canvas 下文字居中比 CSS flex/line-height 更可靠 */

const FONT = "PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif"

function centerText(y: number, boxH: number, fontSize: number) {
  return y / 2 + fontSize * 0.35
}

export function StepBadge({ label }: { label: string }) {
  const size = 32
  const fontSize = 14
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="rex-step-svg"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect width={size} height={size} rx="8" fill="#2563eb" />
      <text
        x={size / 2}
        y={centerText(size, size, fontSize)}
        textAnchor="middle"
        fill="#ffffff"
        fontSize={fontSize}
        fontWeight="600"
        fontFamily={FONT}
      >
        {label}
      </text>
    </svg>
  )
}

export function TopBadge({ rank }: { rank: number }) {
  const text = `Top ${rank}`
  const h = 22
  const fontSize = 11
  const w = Math.max(56, text.length * 6.5 + 20)
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="rex-top-badge-svg"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect width={w} height={h} rx="6" fill="#2563eb" />
      <text
        x={w / 2}
        y={centerText(h, h, fontSize)}
        textAnchor="middle"
        fill="#ffffff"
        fontSize={fontSize}
        fontWeight="600"
        fontFamily="Arial, PingFang SC, Microsoft YaHei, sans-serif"
      >
        {text}
      </text>
    </svg>
  )
}

export function PillBadge({
  text,
  fill = "#2563eb",
  textColor = "#ffffff",
  height = 24,
}: {
  text: string
  fill?: string
  textColor?: string
  height?: number
}) {
  const fontSize = 12
  const w = Math.max(48, text.length * 11 + 24)
  return (
    <svg
      width={w}
      height={height}
      viewBox={`0 0 ${w} ${height}`}
      aria-hidden
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <rect width={w} height={height} rx={height / 2} fill={fill} />
      <text
        x={w / 2}
        y={centerText(height, height, fontSize)}
        textAnchor="middle"
        fill={textColor}
        fontSize={fontSize}
        fontWeight="500"
        fontFamily={FONT}
      >
        {text}
      </text>
    </svg>
  )
}
