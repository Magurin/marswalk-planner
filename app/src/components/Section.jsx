export function Section({ title, action, children }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="text-[13px] font-semibold tracking-wide text-foreground/90">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
