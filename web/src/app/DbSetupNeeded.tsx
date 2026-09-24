import { DatabaseUnavailable } from '@/lib/db';

/**
 * Shown instead of a stack trace when the database is not configured or not
 * reachable — nearly always a DATABASE_URL that was never filled in.
 */
export function DbSetupNeeded({ error }: { error: DatabaseUnavailable }) {
  return (
    <div className="authwrap">
      <div className="authcard" style={{ maxWidth: 620 }}>
        <h1>Database not connected</h1>
        <p className="sub">{error.message}</p>

        {error.detail && <pre className="dbdetail">{error.detail}</pre>}

        <h3>How to fix it</h3>
        <ol className="fixlist">
          <li>
            Open <code>web/.env.local</code>. If it is missing, copy{' '}
            <code>web/.env.example</code> to it.
          </li>
          <li>
            Set <code>DATABASE_URL</code> to a real Postgres database:
            <pre className="dbdetail">{
`# a Postgres running on this machine
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/spirit_tips

# or a free hosted one from neon.tech — use the POOLED string
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb`
            }</pre>
          </li>
          <li>
            Create the tables: <code>npm run migrate</code>
          </li>
          <li>Restart the app.</li>
        </ol>
        <p className="sub" style={{ marginBottom: 0 }}>
          Full steps are in <code>web/README.md</code>.
        </p>
      </div>
    </div>
  );
}
