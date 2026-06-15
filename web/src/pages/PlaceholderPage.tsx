const pageCopy: Record<string, { title: string; body: string }> = {
  dashboard: {
    title: "Dashboard",
    body: "Coming soon",
  },
  roles: {
    title: "Roles",
    body: "Coming soon",
  },
  tasks: {
    title: "Tasks",
    body: "Coming soon",
  },
};

export function PlaceholderPage({ name }: { name: keyof typeof pageCopy }) {
  const copy = pageCopy[name];

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
      </div>
      <div className="empty-panel">
        <h2>{copy.body}</h2>
      </div>
    </section>
  );
}
