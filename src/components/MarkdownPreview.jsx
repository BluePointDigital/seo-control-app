import { markdownToBlocks } from '../lib/markdown'

export function MarkdownPreview({ markdown = '' }) {
  const blocks = markdownToBlocks(markdown)

  return (
    <div className="grid gap-4 text-sm leading-7 text-slate-600 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-slate-950 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-slate-950 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-slate-950 [&_li]:ml-5 [&_li]:list-disc">
      {blocks.map((block, index) => {
        if (block.type === 'h1') return <h1 key={`block-${index}`}>{block.text}</h1>
        if (block.type === 'h2') return <h2 key={`block-${index}`}>{block.text}</h2>
        if (block.type === 'h3') return <h3 key={`block-${index}`}>{block.text}</h3>
        if (block.type === 'list') {
          return (
            <ul key={`block-${index}`}>
              {block.items.map((item, itemIndex) => <li key={`block-${index}-item-${itemIndex}`}>{item}</li>)}
            </ul>
          )
        }
        return <p key={`block-${index}`}>{block.text}</p>
      })}
    </div>
  )
}
