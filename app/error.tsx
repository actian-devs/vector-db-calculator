'use client';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Last line of defence if a link carries something decodeState did not
 * anticipate. The page offers a clean start instead of a blank screen.
 */
export default function ErrorPage() {
  return (
    <div className="lower">
      <section className="in" role="alert">
        <h1>This link could not be read</h1>
        <div className="prose">
          <p>
            Something in the address could not be turned into a workload. Start again from the
            defaults and describe your workload from there.
          </p>
          <p>
            <a className="btn btn-primary" href={`${BASE}/`}>
              Start over
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
