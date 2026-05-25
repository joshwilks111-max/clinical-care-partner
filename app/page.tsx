import { ShieldAlert, OctagonX } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Placeholder shell only. The real two-panel console + turn logic ship in a
// later task (DESIGN.md "UI states", Task 8). This page exists to prove the
// scaffold builds and to make the locked amber-vs-red Alert contract visible.
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <header className="flex items-center gap-3 border-b pb-5">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
          H
        </div>
        <div>
          <h1 className="text-lg font-semibold">
            Clinical Care-Partner — console
          </h1>
          <p className="text-sm text-muted-foreground">
            Clinical decision support · judgment up, execution down
          </p>
        </div>
      </header>

      <section className="mt-8 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Scaffold ready
              <Badge variant="secondary">placeholder</Badge>
            </CardTitle>
            <CardDescription>
              Next.js App Router · TypeScript (strict) · Tailwind · shadcn/ui ·
              Vercel AI Elements (leaf components) · Vitest. The structured
              two-panel console and turn logic are built in a later task.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button>Primary action</Button>
          </CardContent>
        </Card>

        {/* DESIGN CONTRACT (DESIGN.md "UI states"): the amber-vs-red split.
            Amber "safety" = deliberate clinical safety event ("smart decision").
            Red "destructive" = genuine technical error ("something broke"). */}
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Alert variants — the safety-accent contract
          </h2>

          {/* AMBER: deliberate safety event. Used for refusal / no-guideline /
              cap-fired / completeness-fired. Reads as a clinical decision. */}
          <Alert variant="safety">
            <ShieldAlert />
            <AlertTitle>DELIBERATE ABSTENTION — weight required</AlertTitle>
            <AlertDescription>
              No weight in the note. I won&apos;t estimate a paediatric dose
              from age. Amber = a deliberate safety decision, not an error.
            </AlertDescription>
          </Alert>

          {/* RED: reserved for genuine technical errors only. */}
          <Alert variant="destructive">
            <OctagonX />
            <AlertTitle>Technical error — model unreachable</AlertTitle>
            <AlertDescription>
              The model could not be reached (e.g. Zod parse failure or network
              error). Red is reserved for things that actually broke.
            </AlertDescription>
          </Alert>
        </div>
      </section>
    </main>
  );
}
