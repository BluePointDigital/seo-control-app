import { markdownToBlocks } from '../lib/markdown'

export function MarkdownPreview({ markdown = '' }) {
  const blocks = markdownToBlocks(markdown)

  return (
    <>
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
    </>
  )
}
