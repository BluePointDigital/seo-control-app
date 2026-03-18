export function OnboardingPage({ focus, onOpenOrganization, onOpenWorkspace, steps }) {
  return (
    <section className="page-grid">
      <article className="panel span-8">
        <div className="panel-head">
          <h2>Agency onboarding</h2>
          <p>{focus.description}</p>
        </div>
        <div className="stack">
          {steps.map((step) => (
            <div key={step.id} className={step.done ? 'checklist-item done' : 'checklist-item'}>
              <strong>{step.done ? 'Done' : 'Pending'}</strong>
              <span>{step.label}</span>
              <small>{step.hint}</small>
            </div>
          ))}
        </div>
      </article>

      <aside className="panel span-4">
        <div className="panel-head">
          <h2>Next action</h2>
          <p>{focus.title}</p>
        </div>
        <div className="stack">
          <button type="button" onClick={onOpenOrganization}>Open organization settings</button>
          <button type="button" className="secondary" onClick={onOpenWorkspace}>Open active workspace</button>
        </div>
      </aside>
    </section>
  )
}
