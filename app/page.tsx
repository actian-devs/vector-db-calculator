import { Calculator } from '@/components/Calculator';
import { LINKS } from '@/lib/links';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const HUB: { heading: string; links: { title: string; href: string }[] }[] = [
  {
    heading: "when you don't need one",
    links: [LINKS.embedded, LINKS.pyLibs],
  },
  {
    heading: 'where simple setups break',
    links: [LINKS.pgAlt, LINKS.state],
  },
  {
    heading: 'agent memory patterns',
    links: [LINKS.memArch, LINKS.pydantic, LINKS.crewai, LINKS.selfImproving],
  },
  {
    heading: 'picking a database',
    links: [
      LINKS.pinecone,
      LINKS.qdrantAir,
      LINKS.weaviateEdge,
      LINKS.milvus,
      LINKS.chroma,
    ],
  },
  {
    heading: 'get started',
    links: [LINKS.langchain, LINKS.fastapi, LINKS.qdrantMigrate, LINKS.community],
  },
];

export default function Page() {
  return (
    <>
      <a className="skip" href="#controls">
        Skip to the controls
      </a>

      <header className="rail">
        <div className="in">
          <span className="brand">
            {/* Official horizontal logo from the Actian brand kit. A plain img
                is not base-path aware in a static export, so prefix it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="logo"
              src={`${BASE}/actian-logo.svg`}
              alt="Actian"
              width={146}
              height={34}
            />
            <span className="product">
              VectorAI DB <span>&nbsp;/ sizing tool</span>
            </span>
          </span>
          <span className="tagline">no third-party trackers</span>
        </div>
      </header>

      <main>
        <Calculator />

        <div className="lower">
          <section className="in">
            <h2>How this tool decides</h2>
            <div className="prose">
              <p>
                <b>The numbers are exact arithmetic.</b> Vector memory is items multiplied
                by dimensions multiplied by four bytes for float32. Comparisons per query
                is items multiplied by dimensions, because a brute-force search compares
                your query against every stored item. Those figures are true for the
                inputs you set, with no measurement behind them and none needed.
              </p>
              <p>
                <b>The tier break points are a rough guide.</b> They come from that same
                arithmetic plus the widely observed behavior of brute-force search and
                HNSW indexes. They are estimates for sizing a decision, not a benchmark,
                and your hardware, dimensions and query mix will move them. Every one of
                them is editable in the assumptions panel, and whatever you set travels
                with the shared link and the exported record.
              </p>
              <p>
                <b>The scan figure is an order of magnitude</b>, derived from the
                throughput range in the assumptions. It tells you whether a flat scan is
                in the right ballpark, and nothing finer than that.
              </p>
              <p>
                This page publishes no performance table and no vendor comparison figures.
                Where the result points at a dedicated vector database, it does so because
                of the shape of your workload, and the product pages carry the proof from
                there.
              </p>
            </div>
          </section>

          <section className="in" style={{ borderTop: '1px solid var(--line)' }}>
            <h2>Keep reading</h2>
            <div className="groups">
              {HUB.map((group) => (
                <div className="group" key={group.heading}>
                  <h3>{group.heading}</h3>
                  <ul>
                    {group.links.map((l) => (
                      <li key={l.href}>
                        <a href={l.href} rel="noopener" data-hub="true">
                          {l.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <div className="lower lower-foot">
        <footer>
          <div className="in">
            Maintained by{' '}
            <a href={LINKS.github.href} rel="noopener">
              Actian for Developers
            </a>
            .<br />
            No cookies and no analytics.
          </div>
        </footer>
      </div>
    </>
  );
}
