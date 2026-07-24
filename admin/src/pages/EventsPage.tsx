import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AuditRow, type EventRow, type NotifRow } from '../lib/api';

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [notifications, setNotifications] = useState<NotifRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState(true);

  const load = useCallback(() => {
    adminApi
      .events()
      .then((r) => {
        setEvents((r.events || []) as EventRow[]);
        setNotifications((r.notifications || []) as NotifRow[]);
        setAudits((r.audits || []) as AuditRow[]);
        setWarning(r.warning || null);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal'));
  }, []);

  useEffect(() => {
    document.title = 'Events · Profitku Admin';
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [live, load]);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>Events / Live log</h2>
          <p className="muted">Poll 5 dtk · domain events + notif + audit admin</p>
        </div>
        <label className="row muted" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live poll
        </label>
      </div>

      {warning && <p className="muted">{warning}</p>}
      {err && <p className="err">{err}</p>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div>
          <h3 style={{ fontSize: '0.95rem' }}>Platform events</h3>
          {events.length === 0 && <p className="muted">Belum ada event</p>}
          {events.map((e) => (
            <div key={e.id} className="event-item">
              <div className="type">{e.type}</div>
              <div>{e.message}</div>
              <div className="meta">{new Date(e.created_at).toLocaleString('id-ID')}</div>
            </div>
          ))}
        </div>
        <div>
          <h3 style={{ fontSize: '0.95rem' }}>Notifications</h3>
          {notifications.map((n) => (
            <div key={n.id} className="event-item">
              <div className="type">
                {n.channel} · {n.template}
              </div>
              <div className="meta">
                {n.recipient} · {n.status} · {new Date(n.created_at).toLocaleString('id-ID')}
              </div>
            </div>
          ))}
        </div>
        <div>
          <h3 style={{ fontSize: '0.95rem' }}>Admin audit</h3>
          {audits.map((a) => (
            <div key={a.id} className="event-item">
              <div className="type">
                {a.action} · {a.entity}
              </div>
              <div className="meta">
                {a.actor_email} · {a.entity_id} · {new Date(a.created_at).toLocaleString('id-ID')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
