export function StatusView(props: {
  readonly title: string;
  readonly detail?: string;
  readonly actions?: ReadonlyArray<{ readonly label: string; readonly onClick: () => void }>;
}) {
  return (
    <div className="status-view">
      <div className="status-card">
        <div className="status-title">{props.title}</div>
        {props.detail ? <div className="status-detail">{props.detail}</div> : null}
        {props.actions && props.actions.length > 0 ? (
          <div className="status-actions">
            {props.actions.map((action) => (
              <button key={action.label} className="btn" onClick={action.onClick}>
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
