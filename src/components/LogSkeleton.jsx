// Shimmering placeholder that mirrors LogPage's layout (title, encounter tabs, meter
// rows) while a log's data isn't ready yet — e.g. the brief window as the analyze
// overlay clears, or a cold open from a shared link before fights have loaded. Showing
// the shape of the content reads as "almost there" instead of a blank flash.
export default function LogSkeleton({ rows = 8, tabs = 4 }) {
  return (
    <div className="boss-page wide log-skeleton" aria-hidden="true">
      <div className="log-topbar">
        <span className="sk sk-back" />
      </div>

      <div className="page-head center">
        <span className="sk sk-title" />
        <span className="sk sk-sub" />
        <span className="sk sk-toggle" />
      </div>

      <div className="tabbar log-tabs sk-tabs">
        {Array.from({ length: tabs }).map((_, i) => (
          <span key={i} className="sk sk-tab" />
        ))}
      </div>

      <div className="log-encounter">
        <div className="encounter-head">
          <span className="sk sk-enc-title" />
          <span className="sk sk-kicker" />
        </div>
        <div className="table-scroll">
          <div className="sk-meter">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="sk-row">
                <span className="sk sk-rank" />
                <span className="sk sk-avatar" />
                <span className="sk sk-name" />
                {/* Bars taper like a real ranked meter so it reads as a damage table. */}
                <span className="sk sk-bar" style={{ width: `${92 - i * 8}%` }} />
                <span className="sk sk-value" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
