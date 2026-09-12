export default function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">
        This screen is part of {phase}. Phase 1 covers projects, encrypted connections, and
        read-only Oracle tests only.
      </p>
    </div>
  );
}
