import { useEffect, useRef, useState } from 'react'
import { Sparkles, SendHorizontal, Square, Trash2, Check, Loader2 } from 'lucide-react'
import { useStore, startOptions } from '@/store'
import { ask, MODEL } from '@/lib/assistant'
import { Button } from '@/components/ui/button'

const SUGGEST = [
  'Почему у плана такой вердикт и что исправить?',
  'Собери маршрут к самым интересным целям, чтобы успеть до заката',
  'Когда лучше выйти?',
  'Что будет, если на самой дальней точке что-то случится?',
  'Какие цели досягаемы от базы?',
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
    setChat({ msgs, busy: 'Думаю...' })
    controller = new AbortController()
    try {
      const r = await ask({ store: useStore, text: q, prevId: useStore.getState().chat.prevId, signal: controller.signal, startOptions, onStep: (busy) => setChat({ busy }) })
      setChat({ msgs: [...msgs, { role: 'assistant', text: r.text, actions: r.actions }], prevId: r.prevId, busy: null })
    } catch (e) {
      const stopped = e.name === 'AbortError'
      setChat({ msgs: [...msgs, { role: 'error', text: stopped ? 'Остановлено.' : e.message }], busy: null })
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
              <div className="mb-1 flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" />Помощник плана</div>
              <p className="text-muted-foreground">Видит весь текущий план, проверки и цели. Может объяснить вердикт, собрать или поправить маршрут, подобрать время старта, проверить досягаемость и включить слои. Все изменения проходят через ту же модель выхода, что и ручные.</p>
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
          <textarea ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={ready ? 'Спросите или попросите изменить план...' : 'Загружаю данные...'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }}
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[13.5px] outline-none field-sizing-content" aria-label="Сообщение помощнику" />
          {chat.busy
            ? <Button size="icon-sm" variant="secondary" onClick={() => controller?.abort()} aria-label="Остановить"><Square /></Button>
            : <Button size="icon-sm" onClick={() => send(text)} disabled={!text.trim() || !ready} aria-label="Отправить"><SendHorizontal /></Button>}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-muted-foreground">
          <span>{MODEL}, Enter - отправить</span>
          {chat.msgs.length > 0 && !chat.busy && <button className="flex items-center gap-1 hover:text-foreground" onClick={() => setChat({ msgs: [], prevId: null })}><Trash2 className="size-3" />Новый разговор</button>}
        </div>
      </div>
    </div>
  )
}
