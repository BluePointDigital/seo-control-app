import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { FocusCard, PageIntro, StepCard } from '../components/ui/surface'

export function OnboardingPage({ focus, onOpenOrganization, onOpenWorkspace, steps }) {
  return (
    <div className="space-y-6">
      <PageIntro
        badge="Onboarding"
        title="Agency onboarding"
        description="Complete the shared organization connection once, then finish workspace setup in one dedicated place."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Readiness checklist</CardTitle>
            <CardDescription>{focus.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {steps.map((step) => <StepCard key={step.id} done={step.done} hint={step.hint} label={step.label} />)}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <FocusCard
            title={focus.title}
            description={focus.description}
            actionLabel={focus.action}
            onAction={focus.action === 'Open organization settings' ? onOpenOrganization : onOpenWorkspace}
          />

          <Card>
            <CardHeader>
              <CardTitle>Quick links</CardTitle>
              <CardDescription>Jump straight to the area that owns the missing setup step.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Button type="button" variant="secondary" onClick={onOpenOrganization}>Open organization settings</Button>
              <Button type="button" variant="accent" onClick={onOpenWorkspace}>Open workspace setup</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
