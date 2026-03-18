export function WorkspaceHero({
  focus,
  latestJob,
  onPrimaryAction,
  onSecondaryAction,
  readinessScore,
  stepCount,
  steps,
  workspace,
}) {
  return (
    <section className="hero-grid">
      <article className="hero-card hero-main">
        <div>
          <p className="eyebrow">Client Workspace</p>
          <h2>{workspace?.name || 'Workspace'}</h2>
          <p>{focus.description}</p>
        </div>
        <div className="hero-actions">
          <button type="button" onClick={onPrimaryAction}>{focus.action}</button>
          <button type="button" className="secondary" onClick={onSecondaryAction}>Open reports</button>
        </div>
        <div className="hero-metrics">
          <div>
            <span>Readiness</span>
            <strong>{readinessScore}%</strong>
          </div>
          <div>
            <span>Checklist</span>
            <strong>{steps.filter((step) => step.done).length}/{stepCount}</strong>
          </div>
          <div>
            <span>Latest activity</span>
            <strong>{latestJob ? latestJob.jobType : 'No jobs yet'}</strong>
          </div>
        </div>
      </article>

      <aside className="hero-card hero-side">
        <div className="panel-head compact">
          <h2>{focus.title}</h2>
          <p>Beta onboarding is complete when every client workspace is source-ready.</p>
        </div>
        <div className="checklist-list">
          {steps.map((step) => (
            <div key={step.id} className={step.done ? 'checklist-item done' : 'checklist-item'}>
              <strong>{step.done ? 'Done' : 'Pending'}</strong>
              <span>{step.label}</span>
              <small>{step.hint}</small>
            </div>
          ))}
        </div>
      </aside>
    </section>
  )
}
