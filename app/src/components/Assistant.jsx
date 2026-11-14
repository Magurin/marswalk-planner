import { useEffect, useRef, useState } from 'react'
import { Sparkles, SendHorizontal, Square, Trash2, Check, Loader2 } from 'lucide-react'
import { useStore, startOptions } from '@/store'
import { ask } from '@/lib/assistant'
import { Button } from '@/components/ui/button'

const SUGGEST = [
  'Why does the plan get this verdict, and how do I fix it?',
  'Build a route to the most interesting targets that gets back before sunset',
  'When is the best time to head out?',
  'What happens if something goes wrong at the farthest stop?',
  'Which targets can I reach from the base?',
]

// **bold** and line breaks are all the formatting the answers need.
function Text({ text }) {
  return text.split('\n').map((line, i) => (
    <p key={i} className={line.trim() ? '' : 'h-2'}>
      {line.split(/(\*\*[^*]+\*\*)/).map((part, k) => (part.startsWith('**') && part.endsWith('**') ? <b key={k}>{part.slice(2, -2)}</b> : part))}
    </p>
  ))
}

let controller = null

export function Assistant() {
  const chat = useStore((s) => s.chat)
  const ready = useStore((s) => s.ready)
  const setChat = useStore((s) => s.setChat)
  const [text, setText] = useState('')
  const list = useRef(null)
  const input = useRef(null)

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }) }, [chat.msgs, chat.busy])
  useEffect(() => { input.current?.focus() }, [])

  const send = async (q) => {
    q = q.trim()
    if (!q || chat.busy || !ready) return
    setText('')
    const msgs = [...useStore.getState().chat.msgs, { role: 'user', text: q }]
    setChat({ msgs, busy: 'Thinking...' })
    controller = new AbortController()
    try {
      const r = await ask({ store: useStore, text: q, prevId: useStore.getState().chat.prevId, signal: controller.signal, startOptions, onStep: (busy) => setChat({ busy }) })
      setChat({ msgs: [...msgs, { role: 'assistant', text: r.text, actions: r.actions }], prevId: r.prevId, busy: null })
    } catch (e) {
      const stopped = e.name === 'AbortError'
      setChat({ msgs: [...msgs, { role: 'error', text: stopped ? 'Stopped.' : e.message }], busy: null })
    } finally {
      controller = null
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!chat.msgs.length && (
          <div className="space-y-3">
            <div className="rounded-xl border bg-card p-3.5 text-[13.5px]">
              <div className="mb-1 flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" />Plan Assistant</div>
              <p className="text-muted-foreground">Sees the whole current plan, its checks and targets. It can explain the verdict, build or adjust the route, pick a start time, check reach and toggle layers. Every change runs through the same EVA model as manual edits.</p>
            </div>
            <div className="space-y-1.5">
              {SUGGEST.map((q) => <button key={q} onClick={() => send(q)} disabled={!ready} className="block w-full rounded-lg border px-3 py-2 text-left text-[13px] hover:border-primary/50 hover:bg-primary/[0.07] disabled:opacity-50">{q}</button>)}
            </div>
          </div>
        )}
        {chat.msgs.map((m, i) => (
          m.role === 'user'
            ? <div key={i} className="ml-8 rounded-xl rounded-br-sm bg-primary/90 px-3 py-2 text-[13.5px] text-primary-foreground">{m.text}</div>
            : (
              <div key={i} className={`mr-4 space-y-1.5 text-[13.5px] leading-relaxed ${m.role === 'error' ? 'text-nogo' : ''}`}>
                {m.actions?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {m.actions.map((a, k) => <span key={k} className="flex items-center gap-1 rounded-md border border-go/30 bg-go/10 px-1.5 py-0.5 text-[11.5px] text-go"><Check className="size-3" />{a}</span>)}
                  </div>
                )}
                <div className="space-y-0.5"><Text text={m.text} /></div>
              </div>
            )
        ))}
        {chat.busy && <div className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />{chat.busy}</div>}
      </div>
      <div className="border-t p-3">
        <div className="flex items-end gap-2 rounded-xl border bg-background/60 p-1.5 focus-within:border-primary/60">
          <textarea ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={ready ? 'Ask a question or request a plan change...' : 'Loading data...'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }}
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[13.5px] outline-none field-sizing-content" aria-label="Message the Assistant" />
          {chat.busy
            ? <Button size="icon-sm" variant="secondary" onClick={() => controller?.abort()} aria-label="Stop"><Square /></Button>
            : <Button size="icon-sm" onClick={() => send(text)} disabled={!text.trim() || !ready} aria-label="Send"><SendHorizontal /></Button>}
        </div>
        {chat.msgs.length > 0 && !chat.busy && (
          <div className="mt-1.5 flex justify-end text-[11.5px] text-muted-foreground">
            <button className="flex items-center gap-1 hover:text-foreground" onClick={() => setChat({ msgs: [], prevId: null })}><Trash2 className="size-3" />New conversation</button>
          </div>
        )}
      </div>
    </div>
  )
}
